# SoundSight Quick Start

Minimal local run flow for SoundSight.

## Install dependencies

Dependencies are managed with [uv](https://docs.astral.sh/uv/). It creates the
virtualenv and installs from `uv.lock` in one step:

```bash
uv sync                  # backend runtime deps
uv sync --extra dev      # + pytest (to run the test suite)
```

> No GPU torch here — `uv sync` pulls CPU torch from PyPI. For a local CUDA run,
> install a matching torch build yourself (the Docker image handles cu121).

## Configure environment

Copy the local environment file if the project expects one and set the ASR model, port, and any optional LLM variables you want to use.

## Start the app

```bash
uv run python main.py
```

Default local address:

```text
http://127.0.0.1:8000
```

## Basic manual check

- open the app in a browser
- start a session
- allow microphone access
- speak a short phrase
- verify subtitle output appears
- verify agent stats endpoint responds

## Useful endpoints

- `GET /session/status`
- `GET /session/agent/stats`
- `GET /session/agent/recent-decisions`
- `GET /summary/current/live`
