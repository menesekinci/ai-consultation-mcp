const DEFAULT_EMBED_URL = 'http://127.0.0.1:7999/embed';

export interface EmbeddingResult {
  vectors: number[][];
  dim: number;
  model: string;
}

export function getEmbedUrl(): string {
  return process.env.RAG_EMBED_URL || DEFAULT_EMBED_URL;
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  if (!texts.length) {
    return { vectors: [], dim: 0, model: 'unknown' };
  }

  const res = await fetch(getEmbedUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Embedding service error (${res.status}): ${msg}`);
  }

  const data = (await res.json()) as EmbeddingResult;

  if (!Array.isArray(data.vectors)) {
    throw new Error('Embedding service returned invalid vectors');
  }

  return data;
}

export function encodeVector(vector: number[]): Buffer {
  const floatArray = new Float32Array(vector);
  return Buffer.from(floatArray.buffer);
}

export function decodeVector(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
