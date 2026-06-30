"""Shared face-recognition logic built on InsightFace (ArcFace, ResNet-50).

Reference photos live in images/<regno>/ : one sub-folder per student, named by
registration number, holding one or more photos of that student. Every photo is
turned into a 512-D ArcFace embedding; a face matches a student if it is similar
to ANY of that student's photos. (Single loose files images/<regno>.jpg are also
still supported for backward compatibility.)

Embeddings are built ONCE by create_embedd.py and saved to embeddings.pkl. At
runtime the server just loads that file (instant) instead of re-embedding photos
every run. Re-run create_embedd.py whenever you add or change student photos.
"""
from __future__ import annotations

import os
import pickle
from dataclasses import dataclass

import cv2
import numpy as np
from insightface.app import FaceAnalysis

# Directory holding one sub-folder per person, named by registration number.
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "images")

# Permanent, prebuilt embedding database (created by create_embedd.py).
EMBEDDINGS_PATH = os.path.join(os.path.dirname(__file__), "embeddings.pkl")

# Cosine-similarity threshold. ArcFace embeddings are L2-normalised, so this is
# a cosine score in [-1, 1]. ~0.35-0.45 is the usual same-person cutoff; raise
# it to be stricter (fewer false accepts), lower it to be more lenient.
MATCH_THRESHOLD = 0.40


@dataclass
class Match:
    regno: str
    score: float


class FaceRecognizer:
    def __init__(self, det_size: int = 640):
        # buffalo_l = ArcFace recognition (ResNet-50) + SCRFD detector.
        # CPUExecutionProvider keeps it dependency-light; swap in
        # CUDAExecutionProvider if you have a GPU + onnxruntime-gpu.
        self.app = FaceAnalysis(
            name="buffalo_l", providers=["CPUExecutionProvider"]
        )
        self.app.prepare(ctx_id=0, det_size=(det_size, det_size))
        # regno -> list of reference embeddings (one per usable photo).
        self.known: dict[str, list[np.ndarray]] = {}

    # ------------------------------------------------------------------ #
    # Building embeddings (used by create_embedd.py — the slow, one-time step)
    # ------------------------------------------------------------------ #
    def _embed_file(self, path: str) -> np.ndarray | None:
        """Read an image file (by content, ignoring extension) and embed the
        largest face in it. Returns None if unreadable or no face found."""
        img = cv2.imread(path)
        if img is None:
            return None  # not a decodable image
        faces = self.app.get(img)
        if not faces:
            return None
        face = max(faces, key=lambda f: _area(f.bbox))
        return _normalize(face.embedding)

    def build_known_faces(self) -> list[str]:
        """Embed every student's photos into self.known. Returns reg numbers.

        Layout: images/<regno>/<photo>...  (multiple photos per student).
        A loose file images/<regno>.<ext> is also accepted as a 1-photo student.
        This is the expensive step — run it via create_embedd.py, not per server
        start.
        """
        self.known = {}
        loaded: list[str] = []
        for entry in sorted(os.listdir(IMAGES_DIR)):
            full = os.path.join(IMAGES_DIR, entry)

            if os.path.isdir(full):
                regno = entry
                embeddings = []
                for fname in sorted(os.listdir(full)):
                    fpath = os.path.join(full, fname)
                    if not os.path.isfile(fpath):
                        continue
                    emb = self._embed_file(fpath)
                    if emb is None:
                        print(f"  ! {regno}/{fname}: unreadable or no face, skipping")
                    else:
                        embeddings.append(emb)
                if embeddings:
                    self.known[regno] = embeddings
                    loaded.append(regno)
                    print(f"  + {regno}: {len(embeddings)} reference photo(s)")
                else:
                    print(f"  ! {regno}: no usable photos, skipping")

            elif os.path.isfile(full):  # backward-compat: images/<regno>.<ext>
                regno = os.path.splitext(entry)[0]
                emb = self._embed_file(full)
                if emb is not None:
                    self.known.setdefault(regno, []).append(emb)
                    if regno not in loaded:
                        loaded.append(regno)
        return loaded

    # ------------------------------------------------------------------ #
    # Saving / loading the prebuilt embeddings
    # ------------------------------------------------------------------ #
    def save_embeddings(self, path: str = EMBEDDINGS_PATH) -> None:
        """Persist self.known (+ a manifest of source photos) to disk."""
        payload = {
            "version": 1,
            "known": self.known,
            "manifest": _images_manifest(),
        }
        with open(path, "wb") as f:
            pickle.dump(payload, f)

    def load_saved_embeddings(self, path: str = EMBEDDINGS_PATH) -> dict | None:
        """Load prebuilt embeddings into self.known. Returns the saved payload
        (for staleness checks) or None if the file is missing/corrupt."""
        try:
            with open(path, "rb") as f:
                payload = pickle.load(f)
            self.known = payload.get("known", {})
            return payload
        except Exception:
            return None

    def load_known_faces(self) -> list[str]:
        """Server entry point: load the prebuilt embeddings.pkl (instant).

        Falls back to building them once (and saving) if the file is missing, so
        the system still works if create_embedd.py hasn't been run yet — but the
        intended flow is to run create_embedd.py once and let this just load.
        """
        if os.path.exists(EMBEDDINGS_PATH):
            payload = self.load_saved_embeddings()
            if payload is not None and self.known:
                if _images_manifest() != payload.get("manifest"):
                    print("  ! images/ changed since embeddings were built — "
                          "re-run: python create_embedd.py")
                return list(self.known)
            print("  ! embeddings.pkl unreadable — rebuilding.")

        print("  ! No embeddings.pkl found. Building once now "
              "(tip: run 'python create_embedd.py' to control this step)…")
        loaded = self.build_known_faces()
        if loaded:
            self.save_embeddings()
        return loaded

    # ------------------------------------------------------------------ #
    # Matching (runtime)
    # ------------------------------------------------------------------ #
    def _match_embedding(self, emb: np.ndarray) -> Match:
        """Best known match for one (already L2-normalised) embedding.

        A student's score is the MAX cosine similarity over all their reference
        photos, so any matching photo is enough to recognise them."""
        best_regno, best_score = None, -1.0
        for regno, ref_embs in self.known.items():
            score = max(float(np.dot(emb, ref)) for ref in ref_embs)
            if score > best_score:
                best_regno, best_score = regno, score
        if best_score >= MATCH_THRESHOLD:
            return Match(best_regno, best_score)
        return Match(None, best_score)  # a face, but no known person

    def identify_all(self, frame: np.ndarray) -> list[tuple]:
        """Identify EVERY detected face in the frame.

        Returns a list of (face, Match) pairs — one per detected face — so the
        caller can mark attendance for each recognised person and draw a labelled
        box around each face.
        """
        faces = self.app.get(frame)
        if not faces or not self.known:
            return [(f, Match(None, -1.0)) for f in faces]
        return [(f, self._match_embedding(_normalize(f.embedding))) for f in faces]


def _images_manifest() -> dict:
    """Map every file under images/ to (mtime, size) so we can detect changes."""
    manifest = {}
    if not os.path.isdir(IMAGES_DIR):
        return manifest
    for root, _, files in os.walk(IMAGES_DIR):
        for fname in files:
            fpath = os.path.join(root, fname)
            try:
                st = os.stat(fpath)
                manifest[os.path.relpath(fpath, IMAGES_DIR)] = (int(st.st_mtime), st.st_size)
            except OSError:
                pass
    return manifest


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n else v


def _area(bbox) -> float:
    x1, y1, x2, y2 = bbox
    return (x2 - x1) * (y2 - y1)
