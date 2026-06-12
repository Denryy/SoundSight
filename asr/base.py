from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np


@dataclass
class ASRChunk:
    text: str
    start: float
    end: float
    language: str = "ru"


class BaseASREngine(ABC):
    @abstractmethod
    def transcribe_raw(self, audio_np: np.ndarray) -> ASRChunk:
        """Transcribe mono float32 PCM at the engine's sample rate."""
        ...

    @abstractmethod
    def load(self) -> None:
        """Load model into memory."""
        ...
