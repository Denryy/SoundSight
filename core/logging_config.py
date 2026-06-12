"""Central logging configuration for soundsight.

Call setup_logging() once at process start (server lifespan / main entrypoint).
Level is controlled by the SOUNDSIGHT_LOG_LEVEL env var (default INFO).

Replaces the ad-hoc print() debugging the prototype shipped with: a single
formatter, level control, and no full-transcript content at INFO level.
"""

import logging
import os

_CONFIGURED = False


def setup_logging() -> None:
    global _CONFIGURED
    if _CONFIGURED:
        return

    level_name = os.getenv("SOUNDSIGHT_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    # ASCII separator (not an em-dash): Windows consoles default to a non-UTF-8
    # codepage and would mangle / fail to encode "—" when emitting log records.
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    # Quiet noisy third-party loggers that would otherwise flood the console.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    _CONFIGURED = True
