import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("soundsight.ws")

# Reject oversized binary frames before they reach numpy decoding. Matches the
# pipeline's MAX_FRAME_BYTES; the worklet ships ~32 KB frames in practice.
MAX_WS_FRAME_BYTES = 4 * 1024 * 1024

# WebSocket close code for "message too big" (RFC 6455).
WS_CLOSE_TOO_BIG = 1009
# WebSocket close code for "try again later" (RFC 6455) — used to reject a second
# concurrent stream.
WS_CLOSE_AGAIN_LATER = 1013

# The pipeline is a single-session singleton: its per-utterance buffer is shared
# process-wide, so two concurrent streams would interleave and corrupt each
# other's audio. Allow only one active subtitle socket at a time. Safe as a plain
# flag because the event loop is single-threaded (no await between check and set).
_active = False


async def ws_endpoint(websocket: WebSocket, process_audio_cb) -> None:
    global _active
    await websocket.accept()
    if _active:
        logger.warning("rejecting second concurrent subtitle stream (single-session)")
        await websocket.close(code=WS_CLOSE_AGAIN_LATER)
        return
    _active = True
    chunk_n = 0
    logger.info("client connected")
    try:
        while True:
            # receive_bytes() is the correct Starlette 1.0 API for binary frames
            raw = await websocket.receive_bytes()
            if len(raw) > MAX_WS_FRAME_BYTES:
                logger.warning("frame too large (%d bytes) — closing", len(raw))
                await websocket.close(code=WS_CLOSE_TOO_BIG)
                return
            chunk_n += 1
            logger.debug("chunk #%d bytes=%d", chunk_n, len(raw))
            result = await process_audio_cb(raw)
            if result:
                await websocket.send_text(json.dumps(result, ensure_ascii=False))
    except WebSocketDisconnect:
        logger.info("client disconnected after %d chunks", chunk_n)
    except Exception as e:
        logger.exception("ws error: %s", e)
    finally:
        _active = False
