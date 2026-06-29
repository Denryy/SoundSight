"""Gesture-dataset capture endpoint tests (api/routes/dataset.py).

Mounts only the dataset router on a throwaway app (no ASR/lifespan) and points
the storage dir at a tmp_path, so these run fast and never touch torch.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import dataset as ds


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(ds, "DATASET_DIR", tmp_path / "dataset")
    monkeypatch.setattr(ds, "MANIFEST_PATH", tmp_path / "dataset" / "manifest.json")
    app = FastAPI()
    app.include_router(ds.router)
    return TestClient(app)


def _clip(n: int = 3) -> dict:
    return {
        "frames": [{"t": i * 100, "pose": {"rArm": {"el": 10 + i}}} for i in range(n)],
        "hold": 200,
    }


def test_post_clip_creates_take_and_increments(client):
    r = client.post("/avatar/dataset/clip", json={"gloss": "hello", "ru": "привет", "clip": _clip()})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["take"] == 1
    assert body["target"] == 10
    assert body["path"].endswith("hello/01.json")

    r2 = client.post("/avatar/dataset/clip", json={"gloss": "hello", "clip": _clip()})
    assert r2.json()["take"] == 2
    assert r2.json()["takes"] == 2


def test_index_reports_counts_and_label(client):
    client.post("/avatar/dataset/clip", json={"gloss": "thanks", "ru": "спасибо", "clip": _clip()})
    body = client.get("/avatar/dataset").json()
    assert body["glosses"]["thanks"]["takes"] == 1
    assert body["glosses"]["thanks"]["ru"] == "спасибо"
    assert body["target_takes"] == 10


def test_gloss_is_normalised_lowercase(client):
    r = client.post("/avatar/dataset/clip", json={"gloss": "Hello", "clip": _clip()})
    assert r.status_code == 200
    assert r.json()["gloss"] == "hello"


def test_rejects_bad_gloss(client):
    r = client.post("/avatar/dataset/clip", json={"gloss": "bad gloss!", "clip": _clip()})
    assert r.status_code == 422


def test_rejects_empty_frames(client):
    r = client.post("/avatar/dataset/clip", json={"gloss": "x", "clip": {"frames": []}})
    assert r.status_code == 422


def test_rejects_empty_pose(client):
    bad = {"frames": [{"t": 0, "pose": {}}]}
    r = client.post("/avatar/dataset/clip", json={"gloss": "x", "clip": bad})
    assert r.status_code == 422


def test_delete_removes_gloss(client):
    client.post("/avatar/dataset/clip", json={"gloss": "hi", "clip": _clip()})
    client.post("/avatar/dataset/clip", json={"gloss": "hi", "clip": _clip()})
    r = client.delete("/avatar/dataset/hi")
    assert r.json()["removed"] == 2
    assert client.get("/avatar/dataset").json()["glosses"].get("hi") is None
