import { cosineSimilarity, decodeVector, embedTexts } from './embeddings.js';
import { listChunksWithEmbeddings } from './storage.js';

export interface RetrievalOptions {
  topK?: number;
  minScore?: number;
  docIds?: string[];
  docTitles?: string[];
}

export interface RetrievalHit {
  score: number;
  title: string;
  sourceType: string;
  chunkIndex: number;
  content: string;
}

export async function retrieveContext(
  query: string,
  options: RetrievalOptions = {}
): Promise<{ context: string; hits: RetrievalHit[] }> {
  const topK = options.topK ?? 4;
  const minScore = options.minScore ?? 0.35;

  const { vectors } = await embedTexts([query]);
  const queryVector = vectors[0];
  if (!queryVector) {
    return { context: '', hits: [] };
  }

  const queryArray = new Float32Array(queryVector);
  const rows = listChunksWithEmbeddings({ docIds: options.docIds, docTitles: options.docTitles });

  const scored: RetrievalHit[] = rows.map((row) => {
    const vector = decodeVector(row.vector);
    const score = cosineSimilarity(queryArray, vector);
    return {
      score,
      title: row.title,
      sourceType: row.sourceType,
      chunkIndex: row.chunkIndex,
      content: row.content,
    };
  });

  const hits = scored
    .filter((hit) => hit.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (hits.length === 0) {
    return { context: '', hits: [] };
  }

  const context = [
    'Relevant Context (RAG):',
    ...hits.map(
      (hit) => `- [${hit.title} | ${hit.sourceType} | chunk #${hit.chunkIndex}] ${hit.content}`
    ),
  ].join('\n');

  return { context, hits };
}

export function toSnippet(content: string, maxLength = 240): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength).trimEnd() + '…';
}
