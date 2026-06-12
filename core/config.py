import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    ASR_MODEL: str = os.getenv("ASR_MODEL", "large-v3-turbo")
    # On CPU the turbo model is far too slow for live 3s chunks; use a lighter
    # model unless the user pins one explicitly via ASR_MODEL_CPU.
    ASR_MODEL_CPU: str = os.getenv("ASR_MODEL_CPU", "base")
    ASR_LANGUAGE: str = os.getenv("ASR_LANGUAGE", "")
    # Default to Russian: per-chunk language auto-detection on 3s audio is
    # unreliable (misreads RU as EN and vice-versa). Users switch in the UI.
    ASR_MODE: str = os.getenv("ASR_MODE", "ru")  # auto | ru | en | kz
    CHUNK_DURATION_SEC: int = int(os.getenv("CHUNK_DURATION_SEC", "3"))
    SAMPLE_RATE: int = int(os.getenv("SAMPLE_RATE", "16000"))
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # Sign-language output mode for the avatar:
    #   "hybrid" — lexical ISL sign per word when available, else fingerspell
    #              (varied + meaningful; default)
    #   "asl"    — ASL fingerspelling only (spells letter-by-letter; uniform look)
    #   "isl"    — bundled ISL lexical dictionary only (varied but sparse)
    SIGN_LANG: str = os.getenv("SIGN_LANG", "hybrid")


config = Config()
