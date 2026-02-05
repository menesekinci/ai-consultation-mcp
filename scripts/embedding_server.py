from __future__ import annotations

import json
from typing import List

from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer

app = Flask(__name__)
model = SentenceTransformer("all-MiniLM-L6-v2")

@app.post("/embed")
def embed():
    payload = request.get_json(silent=True) or {}
    texts: List[str] = payload.get("texts") or []
    if not isinstance(texts, list) or not texts:
        return jsonify({"error": "texts must be a non-empty list"}), 400

    vectors = model.encode(texts, normalize_embeddings=False).tolist()
    return jsonify({"vectors": vectors, "dim": len(vectors[0]) if vectors else 0, "model": "all-MiniLM-L6-v2"})

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=7999)
