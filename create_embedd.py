"""Build the face-embedding database once and save it permanently.

Walks images/<regno>/ , turns every student photo into a 512-D ArcFace
embedding, and saves them all to embeddings.pkl. The server (recognizer.py /
backend / multicam) then LOADS this file instantly instead of re-embedding
photos on every start.

Run this ONCE after setting up — and again any time you add, remove, or change
student photos in images/ :

    source venv/bin/activate
    python create_embedd.py

That's it. The saved embeddings.pkl stays valid until you re-run this script.
"""
from __future__ import annotations

import os
import time

from recognizer import EMBEDDINGS_PATH, IMAGES_DIR, FaceRecognizer


def main() -> None:
    if not os.path.isdir(IMAGES_DIR):
        print(f"images/ folder not found at {IMAGES_DIR}")
        return

    print("Loading face model (buffalo_l)…")
    rec = FaceRecognizer()

    print(f"Embedding reference photos in {IMAGES_DIR} …")
    print("(this is the slow part — it only happens when you run this script)")
    t0 = time.time()
    loaded = rec.build_known_faces()

    if not loaded:
        print("\nNo usable student photos found. Add photos under "
              "images/<regno>/ and run this again.")
        return

    rec.save_embeddings()
    total_photos = sum(len(v) for v in rec.known.values())
    print(
        f"\n✓ Saved {len(loaded)} students "
        f"({total_photos} photos) -> {EMBEDDINGS_PATH}"
        f"  in {time.time() - t0:.1f}s"
    )
    print("Students:", ", ".join(loaded))
    print("\nThe server will now load these instantly. Re-run this script only "
          "when you change the photos in images/.")


if __name__ == "__main__":
    main()
