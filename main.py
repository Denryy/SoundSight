import uvicorn

from core.config import config
from core.logging_config import setup_logging

if __name__ == "__main__":
    setup_logging()
    uvicorn.run(
        "api.server:app",
        host=config.HOST,
        port=config.PORT,
        reload=False,
        timeout_graceful_shutdown=3,
    )
