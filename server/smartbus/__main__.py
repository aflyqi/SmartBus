import logging

import uvicorn

from . import config


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    uvicorn.run("smartbus.api:app", host=config.HOST, port=config.PORT, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
