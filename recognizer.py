"""Shared face-recognition logic built on InsightFace (ArcFace, ResNet-100).

Loads reference photos from the images/ folder (filenames are registration
numbers), computes a 512-D ArcFace embedding for each, and exposes a matcher
that turns a webcam frame into the best-matching registration number.
"""
from __future__ import annotations

import glob
import os
from dataclasses import dataclass

import numpy as np
from insightface.app import FaceAnalysis

# Directory holding one reference photo per person, named <regno>.<ext>.
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "images")

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
        # buffalo_l = ArcFace recognition (ResNet-100) + SCRFD detector.
        # CPUExecutionProvider keeps it dependency-light; swap in
        # CUDAExecutionProvider if you have a GPU + onnxruntime-gpu.
        self.app = FaceAnalysis(
            name="buffalo_l", providers=["CPUExecutionProvider"]
        )
        self.app.prepare(ctx_id=0, det_size=(det_size, det_size))
        self.known: dict[str, np.ndarray] = {}

    def load_known_faces(self) -> list[str]:
        """Embed every image in IMAGES_DIR. Returns the reg numbers loaded."""
        paths = sorted(
            p
            for ext in ("png", "jpg", "jpeg", "bmp", "webp")
            for p in glob.glob(os.path.join(IMAGES_DIR, f"*.{ext}"))
        )
        loaded = []
        for path in paths:
            regno = os.path.splitext(os.path.basename(path))[0]
            import cv2

            img = cv2.imread(path)
            if img is None:
                print(f"  ! could not read {path}, skipping")
                continue
            faces = self.app.get(img)
            if not faces:
                print(f"  ! no face found in {regno}, skipping")
                continue
            # If a reference photo has several faces, keep the largest one.
            face = max(faces, key=lambda f: _area(f.bbox))
            self.known[regno] = _normalize(face.embedding)
            loaded.append(regno)
        return loaded

    def _match_embedding(self, emb: np.ndarray) -> Match:
        """Best known match for one (already L2-normalised) embedding."""
        best_regno, best_score = None, -1.0
        for regno, known_emb in self.known.items():
            score = float(np.dot(emb, known_emb))  # cosine (both normalised)
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


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n else v


def _area(bbox) -> float:
    x1, y1, x2, y2 = bbox
    return (x2 - x1) * (y2 - y1)
