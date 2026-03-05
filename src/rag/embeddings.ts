import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = true;

let embedPipeline: Awaited<ReturnType<typeof pipeline>> | null = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

async function getPipeline() {
  if (!embedPipeline) {
    embedPipeline = await pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    });
  }
  return embedPipeline;
}

export interface EmbeddingResult {
  vectors: number[][];
  dim: number;
  model: string;
}

export async function embedTexts(texts: string[]): Promise<EmbeddingResult> {
  if (!texts.length) {
    return { vectors: [], dim: 0, model: MODEL_NAME };
  }

  const pipe = await getPipeline();

  const vectors: number[][] = await Promise.all(
    texts.map(async (text) => {
      const output = await pipe(text, {
        pooling: 'mean',
        normalize: true,
      } as any) as { data: Float32Array };
      return Array.from(output.data);
    })
  );

  return {
    vectors,
    dim: vectors[0]?.length || 0,
    model: MODEL_NAME,
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
    await getPipeline();
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

export function getEmbedUrl(): string {
  return '';
}
