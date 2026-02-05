import { retrieveContext, toSnippet } from '../../rag/retrieval.js';
import {
  listDocuments,
  listMemories,
  listChunksByDocument,
  insertMemory,
  createDocument,
  insertChunks,
  insertEmbedding,
} from '../../rag/storage.js';
import { chunkText, estimateTokenCount } from '../../rag/chunking.js';
import { embedTexts } from '../../rag/embeddings.js';

export async function ragSearch(input: {
  query: string;
  docIds?: string[];
  docTitles?: string[];
  topK?: number;
  minScore?: number;
}): Promise<{ contextPreview: string; hits: Array<{ score: number; title: string; sourceType: string; chunkIndex: number; snippet: string }> }> {
  const result = await retrieveContext(input.query, {
    docIds: input.docIds,
    docTitles: input.docTitles,
    topK: input.topK,
    minScore: input.minScore,
  });

  return {
    contextPreview: result.context,
    hits: result.hits.map((hit) => ({
      score: hit.score,
      title: hit.title,
      sourceType: hit.sourceType,
      chunkIndex: hit.chunkIndex,
      snippet: toSnippet(hit.content),
    })),
  };
}

export function ragListDocs(): { documents: ReturnType<typeof listDocuments> } {
  return { documents: listDocuments() };
}

export function ragListMemories(): { memories: ReturnType<typeof listMemories> } {
  return { memories: listMemories() };
}

export function ragGetDocChunks(input: { documentId: string }): { chunks: Array<{ id: string; chunkIndex: number; content: string }> } {
  return { chunks: listChunksByDocument(input.documentId) };
}

export async function ragAddMemory(input: { category: string; title: string; content: string }): Promise<{ memoryId: string; documentId: string; chunkCount: number }> {
  const memory = insertMemory({
    category: input.category as any,
    title: input.title,
    content: input.content,
    source: 'manual',
  });

  const doc = createDocument({
    title: `Memory: ${input.title}`,
    sourceType: 'manual',
    sourceUri: 'memory',
    mimeType: 'text/plain',
  });

  const chunks = chunkText(input.content);
  const chunkRecords = insertChunks(
    doc.id,
    chunks.map((text) => ({ content: text, tokenCount: estimateTokenCount(text) }))
  );

  const embeddingResult = await embedTexts(chunkRecords.map((c) => c.content));
  chunkRecords.forEach((chunk, idx) => {
    const vector = embeddingResult.vectors[idx];
    if (vector) {
      insertEmbedding({
        chunkId: chunk.id,
        vector,
        dim: embeddingResult.dim,
        model: embeddingResult.model,
      });
    }
  });

  return { memoryId: memory.id, documentId: doc.id, chunkCount: chunkRecords.length };
}
