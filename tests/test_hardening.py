"""
Regression tests for the security/robustness hardening:
  - core.pipeline._parse_frame rejects malformed/oversized/bad-rate frames
  - core.session bounds transcript length and retained-session count

Run:  python -m pytest tests/ -v
"""

import os
import struct
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.pipeline import (
    _parse_frame,
    FrameError,
    HEADER_MAGIC,
    MAX_FRAME_BYTES,
    TARGET_RATE,
)
from core.session import (
    SessionManager,
    MAX_TRANSCRIPT_SEGMENTS,
    MAX_RETAINED_SESSIONS,
)


# ---------------------------------------------------------------------------
# Frame parsing
# ---------------------------------------------------------------------------

def _framed(samples: np.ndarray, rate: int = TARGET_RATE) -> bytes:
    header = struct.pack(">I", HEADER_MAGIC) + struct.pack("<I", rate)
    return header + samples.astype(np.float32).tobytes()


def test_valid_framed_audio_parses():
    samples = np.ones(160, dtype=np.float32)
    audio, rate = _parse_frame(_framed(samples, 48_000))
    assert rate == 48_000
    assert audio.size == 160
    np.testing.assert_allclose(audio, samples)


def test_headerless_audio_assumes_target_rate():
    samples = np.zeros(64, dtype=np.float32)
    audio, rate = _parse_frame(samples.tobytes())
    assert rate == TARGET_RATE
    assert audio.size == 64


def test_non_multiple_of_four_payload_rejected():
    # 8-byte header + 3 trailing bytes → not decodable as float32.
    raw = struct.pack(">I", HEADER_MAGIC) + struct.pack("<I", TARGET_RATE) + b"\x00\x00\x00"
    with pytest.raises(FrameError):
        _parse_frame(raw)


def test_headerless_odd_length_rejected():
    with pytest.raises(FrameError):
        _parse_frame(b"\x00\x00\x00")  # 3 bytes, not a multiple of 4


def test_implausible_sample_rate_rejected():
    samples = np.zeros(16, dtype=np.float32)
    for bad_rate in (0, 1, 7_999, 200_000, 0xFFFFFFFF):
        with pytest.raises(FrameError):
            _parse_frame(_framed(samples, bad_rate))


def test_oversized_frame_rejected():
    raw = b"\x00" * (MAX_FRAME_BYTES + 4)
    with pytest.raises(FrameError):
        _parse_frame(raw)


# ---------------------------------------------------------------------------
# Session bounding
# ---------------------------------------------------------------------------

def test_transcript_is_bounded():
    mgr = SessionManager()
    session = mgr.create()
    for i in range(MAX_TRANSCRIPT_SEGMENTS + 50):
        session.append_text(f"segment {i}")
    assert len(session.transcript) == MAX_TRANSCRIPT_SEGMENTS
    # Oldest dropped (FIFO): the most recent segment survives.
    assert session.transcript[-1] == f"segment {MAX_TRANSCRIPT_SEGMENTS + 49}"


def test_retained_sessions_are_bounded():
    mgr = SessionManager()
    for _ in range(MAX_RETAINED_SESSIONS + 25):
        mgr.create()
    assert len(mgr._sessions) <= MAX_RETAINED_SESSIONS


def test_current_session_survives_eviction():
    mgr = SessionManager()
    for _ in range(MAX_RETAINED_SESSIONS + 25):
        mgr.create()
    current = mgr.current()
    assert current is not None
    assert current.id in mgr._sessions
