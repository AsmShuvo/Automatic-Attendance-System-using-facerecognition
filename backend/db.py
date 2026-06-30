"""MongoDB access for the attendance system (local for now, Atlas later).

Stores the per-room camera configuration in the `rooms` collection:
    { "room": "G1", "cameras": [ { "name": ..., "source": ... }, ... ] }

Everything degrades gracefully: if MongoDB is unreachable, the helpers return
empty/None so the backend can fall back to config.json. Point at a different
server with the MONGO_URI env var (e.g. an Atlas connection string).
"""
from __future__ import annotations

import os

from pymongo import MongoClient
from pymongo.errors import PyMongoError

MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.environ.get("MONGO_DB", "attendance")

_client: MongoClient | None = None


def get_client() -> MongoClient | None:
    """Cached client with a short timeout so a down DB fails fast."""
    global _client
    if _client is None:
        try:
            _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=1000)
        except PyMongoError:
            return None
    return _client


def is_up() -> bool:
    try:
        client = get_client()
        client.admin.command("ping")
        return True
    except PyMongoError:
        return False


def _rooms():
    client = get_client()
    return client[DB_NAME]["rooms"] if client else None


def upsert_room(room: str, cameras: list) -> bool:
    """Create or replace a room's camera list. Returns True on success."""
    col = _rooms()
    if col is None:
        return False
    try:
        col.update_one({"room": room}, {"$set": {"cameras": cameras}}, upsert=True)
        return True
    except PyMongoError:
        return False


def get_room_cameras(room: str) -> list | None:
    """Cameras for a room, or None if MongoDB is unreachable."""
    col = _rooms()
    if col is None:
        return None
    try:
        doc = col.find_one({"room": room})
        return (doc or {}).get("cameras", [])
    except PyMongoError:
        return None


def list_rooms() -> list | None:
    """All room names, or None if MongoDB is unreachable."""
    col = _rooms()
    if col is None:
        return None
    try:
        return sorted(d["room"] for d in col.find({}, {"room": 1, "_id": 0}))
    except PyMongoError:
        return None
