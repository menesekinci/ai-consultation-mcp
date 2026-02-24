const DEFAULT_EMBED_URL = 'http://127.0.0.1:11434';

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

  const model = process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
  const baseUrl = getEmbedUrl();

  const embeddings = await Promise.all(
    texts.map(async (text) => {
      const res = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: text }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`Embedding service error (${res.status}): ${msg}`);
      }

      const data = (await res.json()) as { embedding: number[] };
      return data.embedding;
    })
  );

  return {
    vectors: embeddings,
    dim: embeddings[0]?.length || 0,
    model,
  };
}

export function encodeVector(vector: number[]): Buffer {
  const floatArray = new Float32Array(vector);
  return Buffer.from(floatArray.buffer);
}

export function decodeVector(buffer: Buffer): Float32Array {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

export async function checkEmbedServiceHealth(): Promise<{ available: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const model = process.env.RAG_EMBED_MODEL || 'nomic-embed-text';
    const res = await fetch(`${getEmbedUrl()}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: 'health check' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { available: false, error: `HTTP ${res.status}` };
    }
    return { available: true };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
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
