import { describe, it, expect } from 'vitest';
import { chunkText, estimateTokenCount } from '../rag/chunking.js';
import { cosineSimilarity } from '../rag/embeddings.js';

describe('rag chunking', () => {
  it('splits long text into chunks', () => {
    const text = 'word '.repeat(400);
    const chunks = chunkText(text, { chunkSize: 200, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeGreaterThan(0);
  });

  it('estimates token count', () => {
    expect(estimateTokenCount('hello world')).toBeGreaterThan(1);
  });
});

describe('rag cosine similarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});
