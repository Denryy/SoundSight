"""
Audio processor: parse frame → resample → VAD → ASR → Agent → outputs.

Wire protocol (8-byte header):
  Bytes 0-3: uint32 BE 0x4C414100 ("LAA\0")
  Bytes 4-7: uint32 LE sample rate
  Bytes 8+:  float32 LE mono PCM

After ASR the segment is handed to AgentController, which applies
rule-based policy to decide whether and how to route it to
subtitles, avatar synthesis, and session transcript.
"""

import asyncio
import logging
import os
import struct
import time

import numpy as np

from agent import llm_refiner
from agent.controller import agent_controller
from asr.whisper_engine import WhisperEngine
from avatar.sync import sync_chunk, SyncedFrame
from core.config import config
from core.session import session_manager
from processing.structurer import structure_chunk

logger = logging.getLogger("soundsight.pipeline")

TARGET_RATE = config.SAMPLE_RATE  # 16000

SILENCE_RMS = float(os.getenv("SILENCE_RMS", "0.002"))

# ── Streaming ASR (interim + final) ───────────────────────────────────────
# Audio is accumulated into the current utterance and re-transcribed live so
# text appears while the user is still speaking, then finalised on a pause.
SPEECH_RMS = float(os.getenv("SPEECH_RMS", "0.01"))
"""Frame RMS above this counts as speech (well above SILENCE_RMS)."""
ENDPOINT_SILENCE = 0.5
"""Seconds of trailing silence that finalise the current utterance."""
MAX_UTT_SEC = 12.0
"""Hard cap — finalise non-stop speech even without a pause."""
INTERIM_EVERY_SEC = 2.0
"""Re-transcribe for a live (interim) caption after this much new audio (CPU).
Must comfortably exceed ASR time per call so the stream never backs up."""

INTERIM_EVERY_SEC_GPU = 0.6
"""Tighter interim cadence on GPU, where each transcription is far faster."""
PREROLL_SEC = 0.3
"""Lead-in kept before speech is detected so word onsets aren't clipped."""

HEADER_MAGIC = 0x4C414100
HEADER_SIZE = 8
FLOAT32_SIZE = 4

# Hard caps on a single incoming audio frame. The browser worklet ships ~0.5s
# frames (≈32 KB at 16 kHz f32); anything far beyond that is malformed or hostile.
MAX_FRAME_BYTES = 4 * 1024 * 1024  # 4 MB
# Plausible source sample rates a browser AudioContext may report.
MIN_SAMPLE_RATE = 8_000
MAX_SAMPLE_RATE = 192_000

# Live (per-utterance) LLM rewriting of subtitles is OFF by default: for an
# accessibility tool the live caption must stay a faithful transcript, and
# rewriting adds latency + risks translating/dropping words. The session SUMMARY
# still uses the LLM (SOUNDSIGHT_ENABLE_LLM) — only the live stream is gated here.
# Opt in with SOUNDSIGHT_LLM_LIVE_REFINE=true (cleanup only; never condenses/translates).
LLM_LIVE_REFINE = os.getenv("SOUNDSIGHT_LLM_LIVE_REFINE", "false").lower() == "true"


class FrameError(ValueError):
    """Raised when an incoming audio frame is malformed or out of bounds."""


def _decode_pcm(payload: bytes) -> np.ndarray:
    """Decode little-endian float32 PCM, rejecting truncated buffers.

    np.frombuffer raises ValueError when the byte length is not a multiple of
    the dtype size, so a single odd-length frame would otherwise crash the WS
    handler. Validate explicitly and raise a typed error the caller can swallow.
    """
    if len(payload) % FLOAT32_SIZE != 0:
        raise FrameError(
            f"PCM payload length {len(payload)} is not a multiple of {FLOAT32_SIZE}"
        )
    return np.frombuffer(payload, dtype=np.float32).copy()


def _parse_frame(raw: bytes) -> tuple[np.ndarray, int]:
    """Parse a wire frame into (mono float32 PCM, sample_rate).

    Raises FrameError on any malformed input so a hostile or buggy client
    cannot crash the audio handler with an unhandled exception.
    """
    if len(raw) > MAX_FRAME_BYTES:
        raise FrameError(f"frame too large: {len(raw)} bytes (cap {MAX_FRAME_BYTES})")

    if len(raw) >= HEADER_SIZE:
        magic = struct.unpack_from(">I", raw, 0)[0]
        if magic == HEADER_MAGIC:
            src_rate = struct.unpack_from("<I", raw, 4)[0]
            if not (MIN_SAMPLE_RATE <= src_rate <= MAX_SAMPLE_RATE):
                raise FrameError(f"implausible sample rate: {src_rate}")
            audio_np = _decode_pcm(raw[HEADER_SIZE:])
            logger.debug("src_rate=%d samples=%d", src_rate, audio_np.size)
            return audio_np, src_rate

    audio_np = _decode_pcm(raw)
    logger.debug("no header, assuming %d Hz", TARGET_RATE)
    return audio_np, TARGET_RATE


def _resample(audio: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    if src_rate == dst_rate:
        return audio
    try:
        import torch
        import torchaudio.functional as F
        t = torch.from_numpy(audio).unsqueeze(0)
        out = F.resample(t, src_rate, dst_rate).squeeze(0).numpy()
        logger.debug("resampled %d@%d → %d@%d", len(audio), src_rate, len(out), dst_rate)
        return out.astype(np.float32)
    except Exception as e:
        logger.warning("torchaudio resample failed (%s), linear interp", e)
        n = int(len(audio) * dst_rate / src_rate)
        return np.interp(np.linspace(0, len(audio)-1, n), np.arange(len(audio)), audio).astype(np.float32)


def _is_silence(audio: np.ndarray) -> tuple[bool, float]:
    rms = float(np.sqrt(np.mean(audio ** 2)))
    return rms < SILENCE_RMS, rms


class Pipeline:
    def __init__(self) -> None:
        self._asr = WhisperEngine()
        self._model_loaded = False
        # Streaming utterance state
        self._utt = np.zeros(0, dtype=np.float32)
        self._utt_silence = 0.0   # trailing silence (sec)
        self._utt_speech = False  # has the buffer contained speech?
        self._utt_last_tx = 0     # sample count at last interim transcribe
        self._utt_tx_count = 0    # interim transcribes done this utterance
        self._interim_every = INTERIM_EVERY_SEC  # set per-device in ensure_loaded

    def ensure_loaded(self) -> None:
        if not self._model_loaded:
            self._asr.load()
            self._warmup()
            self._interim_every = (
                INTERIM_EVERY_SEC_GPU if self._asr.device == "cuda" else INTERIM_EVERY_SEC
            )
            logger.info("interim cadence = %ss (%s)", self._interim_every, self._asr.device)
            self._model_loaded = True

    def _warmup(self) -> None:
        """Run one throwaway transcription so the first real chunk isn't slow."""
        try:
            t0 = time.time()
            self._asr.transcribe_raw(np.zeros(TARGET_RATE, dtype=np.float32))
            logger.info("ASR warmup done in %.2fs", time.time() - t0)
        except Exception as e:
            logger.warning("ASR warmup skipped (%s)", e)

    def reset_state(self) -> None:
        """Reset inter-session state (call when a new session starts)."""
        agent_controller.reset_session()
        self._reset_utt()

    def _reset_utt(self) -> None:
        self._utt = np.zeros(0, dtype=np.float32)
        self._utt_silence = 0.0
        self._utt_speech = False
        self._utt_last_tx = 0
        self._utt_tx_count = 0

    @property
    def asr_mode(self) -> str:
        """Current ASR language mode."""
        return self._asr.mode

    def set_asr_mode(self, mode: str) -> None:
        """Switch ASR language mode (reloads model if backend changes)."""
        self._asr.set_mode(mode)

    async def process_bytes(self, raw: bytes) -> dict | None:
        if not self._model_loaded:
            return None

        session = session_manager.current()
        if session is None or not session.active:
            return None

        try:
            audio_np, src_rate = _parse_frame(raw)
        except FrameError as e:
            logger.warning("dropping malformed frame: %s", e)
            return None
        if audio_np.size == 0:
            return None
        if src_rate != TARGET_RATE:
            audio_np = _resample(audio_np, src_rate, TARGET_RATE)

        # ── Accumulate into the current utterance, track speech vs silence ──
        rms = float(np.sqrt(np.mean(audio_np ** 2)))
        frame_sec = len(audio_np) / TARGET_RATE
        self._utt = (
            np.concatenate([self._utt, audio_np]) if self._utt.size else audio_np
        )
        if rms > SPEECH_RMS:
            self._utt_speech = True
            self._utt_silence = 0.0
        else:
            self._utt_silence += frame_sec

        # No speech captured yet — keep only a short pre-roll and wait.
        if not self._utt_speech:
            keep = int(PREROLL_SEC * TARGET_RATE)
            if self._utt.size > keep:
                self._utt = self._utt[-keep:]
            return None

        utt_sec = self._utt.size / TARGET_RATE
        is_final = self._utt_silence >= ENDPOINT_SILENCE or utt_sec >= MAX_UTT_SEC
        new_sec = (self._utt.size - self._utt_last_tx) / TARGET_RATE

        # Space out interims so ASR stays ahead of the incoming stream
        # (per-call ASR must fit inside this budget or the backlog grows).
        if not is_final and new_sec < self._interim_every:
            return None

        # ── Transcribe the whole utterance so far ──────────────────────────
        loop = asyncio.get_running_loop()
        buf = self._utt.copy()
        t0 = time.time()
        try:
            # Interim captions decode greedily (fast); only the final caption
            # pays for beam search. Keeps live latency flat as the utterance grows.
            chunk = await loop.run_in_executor(
                None, self._asr.transcribe_raw, buf, not is_final
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("ASR error: %s", e)
            return None
        self._utt_last_tx = self._utt.size
        self._utt_tx_count += 1
        text = chunk.text.strip()
        logger.info("ASR %.2fs %s — %r", time.time() - t0,
                    "FINAL" if is_final else "interim", text[:80])

        # Session may have stopped while ASR ran.
        session = session_manager.current()
        if session is None or not session.active:
            self._reset_utt()
            return None

        if not is_final:
            # Live caption: text only, no routing/avatar (those run on FINAL).
            if not text:
                return None
            return {"type": "subtitle_interim", "text": text, "timestamp": chunk.start}

        # ── Utterance ended → finalise ─────────────────────────────────────
        self._reset_utt()
        if not text:
            return None
        return await self._finalize(text, chunk.start, session)

    async def _finalize(self, text: str, timestamp: float, session) -> dict | None:
        """Run the agent + avatar + LLM on a completed utterance, build payload."""
        structured = structure_chunk(text)
        keywords: list[str] = structured["keywords"]

        decision = agent_controller.process(text, keywords=keywords)
        if not decision.is_relevant:
            logger.debug("agent dropped — %s | %r", decision.reason, text[:80])
            return None

        # Optional LLM cleanup of the LIVE caption — opt-in and cleanup-only, so
        # the transcript stays faithful (no translation, no dropped words). The
        # session summary uses the LLM separately, at /session/stop.
        text_out = text
        if LLM_LIVE_REFINE and llm_refiner.is_enabled():
            text_out = await llm_refiner.refine_text(text)

        if decision.include_in_summary:
            session.append_text(text_out)

        # Avatar synthesis runs translation (argostranslate) — keep it off the
        # event loop so it never stalls the live audio stream.
        synced: SyncedFrame | None = None
        if decision.include_in_avatar:
            loop = asyncio.get_running_loop()
            synced = await loop.run_in_executor(
                None, sync_chunk, text_out, timestamp
            )

        payload = agent_controller.build_subtitle_payload(
            decision=decision,
            synced_frame=synced,
            timestamp=timestamp,
        )
        payload["text"] = text_out
        payload["keywords"] = keywords if decision.highlight_keywords else []
        return payload


pipeline = Pipeline()
