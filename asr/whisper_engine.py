"""
WhisperEngine — supports multiple language modes:
  - "auto": large-v3-turbo, language auto-detect
  - "ru":   large-v3-turbo, language=ru, beam_size=5
  - "en":   large-v3-turbo, language=en, beam_size=5
  - "kz":   abilmansplus/whisper-turbo-ksc2 (fine-tuned on Kazakh), language=kk, beam_size=5
"""

import logging
import time
import numpy as np

from asr.base import BaseASREngine, ASRChunk
from core.config import config

logger = logging.getLogger("soundsight.asr")


class WhisperEngine(BaseASREngine):
    def __init__(self) -> None:
        self._model = None
        self._device = "cpu"
        self._use_fp16 = False
        self._mode = config.ASR_MODE          # "auto" | "ru" | "en" | "kz"
        self._model_name = config.ASR_MODEL   # default large-v3-turbo

    def load(self) -> None:
        import torch
        self._device = "cuda" if torch.cuda.is_available() else "cpu"

        # Pick a CPU-friendly model when no GPU is available so live 3s chunks
        # transcribe in near-real-time instead of lagging seconds behind.
        if self._device == "cpu":
            self._model_name = config.ASR_MODEL_CPU
            logger.info("CPU detected — using lighter model %r (set ASR_MODEL_CPU to override)",
                        self._model_name)
        else:
            self._model_name = config.ASR_MODEL

        if self._mode == "kz":
            self._load_transformers(torch)
        else:
            self._load_whisper(torch)

    def _load_whisper(self, torch) -> None:
        """Load openai/whisper via whisper package (used for auto/ru/en)."""
        import whisper
        name = self._model_name
        logger.info("Loading %s (mode=%s) on %s...", name, self._mode, self._device)
        if self._device == "cuda":
            try:
                self._model = whisper.load_model(name, device="cpu").half().cuda()
                self._use_fp16 = True
                vram = round(torch.cuda.memory_allocated() / 1024**3, 2)
                logger.info("Loaded on cuda fp16, VRAM=%sGB", vram)
                self._backend = "whisper"
                return
            except torch.OutOfMemoryError:
                logger.warning("CUDA OOM, falling back to CPU")
                torch.cuda.empty_cache()
        self._model = whisper.load_model(name, device="cpu")
        self._use_fp16 = False
        self._backend = "whisper"
        logger.info("Loaded on cpu")

    def _load_transformers(self, torch) -> None:
        """Load fine-tuned KZ model via transformers pipeline."""
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline as hf_pipeline
        model_id = "abilmansplus/whisper-turbo-ksc2"
        logger.info("Loading KZ model %s on %s...", model_id, self._device)
        dtype = torch.float16 if self._device == "cuda" else torch.float32
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            model_id, torch_dtype=dtype, low_cpu_mem_usage=True,
        ).to(self._device)
        processor = AutoProcessor.from_pretrained(model_id)
        self._model = hf_pipeline(
            "automatic-speech-recognition",
            model=model,
            tokenizer=processor.tokenizer,
            feature_extractor=processor.feature_extractor,
            torch_dtype=dtype,
            device=self._device,
        )
        self._backend = "transformers"
        logger.info("KZ model loaded on %s", self._device)

    @property
    def mode(self) -> str:
        """Current ASR language mode (auto | ru | en | kz)."""
        return self._mode

    @property
    def device(self) -> str:
        """Compute device the model is loaded on ('cuda' or 'cpu')."""
        return self._device

    def set_mode(self, mode: str) -> None:
        """Switch language mode at runtime. Reloads model if backend changes."""
        if mode == self._mode:
            return
        old_backend = getattr(self, "_backend", None)
        self._mode = mode
        needs_kz = mode == "kz"
        was_kz = old_backend == "transformers"
        if needs_kz != was_kz:
            # Backend change — reload
            logger.info("Mode change %s → %s, reloading...",
                        old_backend, "kz" if needs_kz else "whisper")
            self._model = None
            import torch as _t
            if self._device == "cuda":
                _t.cuda.empty_cache()
            self.load()
        else:
            logger.info("Mode switched to %s (no reload needed)", mode)

    def transcribe_raw(self, audio_np: np.ndarray, fast: bool = False) -> ASRChunk:
        """Transcribe mono float32 PCM.

        fast=True  → greedy decoding (no beam search). Used for live *interim*
                     captions: each interim re-transcribes the whole growing
                     utterance, so cost must stay bounded or words lag behind.
        fast=False → beam search for the *final* caption (accuracy over speed).
        """
        if self._model is None:
            raise RuntimeError("Model not loaded")

        t0 = time.time()

        if self._backend == "transformers":
            result_text = self._transcribe_kz(audio_np, fast=fast)
        else:
            result_text = self._transcribe_whisper(audio_np, fast=fast)

        elapsed = time.time() - t0
        logger.info("%.2fs [%s]%s — %r", elapsed, self._mode,
                    " fast" if fast else "", result_text[:80])
        return ASRChunk(text=result_text, start=t0, end=t0 + elapsed, language=self._mode)

    def _transcribe_whisper(self, audio_np: np.ndarray, fast: bool = False) -> str:
        lang_map = {"ru": "ru", "en": "en", "auto": None}
        lang = lang_map.get(self._mode, None)
        # Beam search improves accuracy but costs latency. Interim captions use
        # greedy (beam=1) so they stay snappy as the utterance grows; the final
        # caption uses a small beam on GPU for accuracy.
        beam = 1 if fast else (2 if self._device == "cuda" else 1)

        kwargs = dict(
            language=lang,
            task="transcribe",
            condition_on_previous_text=False,
            beam_size=beam,
        )

        if self._use_fp16:
            import torch
            with torch.amp.autocast("cuda"):
                result = self._model.transcribe(audio_np, fp16=True, **kwargs)
        else:
            result = self._model.transcribe(audio_np, fp16=False, **kwargs)

        return result.get("text", "").strip()

    def _transcribe_kz(self, audio_np: np.ndarray, fast: bool = False) -> str:
        num_beams = 1 if fast else 5
        result = self._model(
            {"array": audio_np, "sampling_rate": 16000},
            generate_kwargs={"language": "kk", "task": "transcribe", "num_beams": num_beams},
        )
        return result.get("text", "").strip()
