import fs from 'fs/promises';
import path from 'path';
import { retrieveContext, toSnippet } from '../../rag/retrieval.js';
import {
  listDocuments,
  listMemories,
  listChunksByDocument,
  insertMemory,
  createDocument,
  insertChunks,
  insertEmbedding,
  deleteDocument,
  listFolders,
  updateDocumentFolder,
  bulkUpdateDocumentFolders,
} from '../../rag/storage.js';
import { chunkText, estimateTokenCount } from '../../rag/chunking.js';
import { embedTexts } from '../../rag/embeddings.js';
import { extractTextFromBuffer, inferMimeType } from '../../rag/ingest.js';
import { getTitleFromPath, isDuplicateTitle } from '../../rag/dedupe.js';

export async function ragSearch(input: {
  query: string;
  docIds?: string[];
  docTitles?: string[];
  topK?: number;
  minScore?: number;
  folder?: string;
}): Promise<{ contextPreview: string; hits: Array<{ score: number; title: string; sourceType: string; chunkIndex: number; snippet: string }> }> {
  const result = await retrieveContext(input.query, {
    docIds: input.docIds,
    docTitles: input.docTitles,
    topK: input.topK,
    minScore: input.minScore,
    folder: input.folder,
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

export function ragListDocs(input?: { folder?: string }): { documents: ReturnType<typeof listDocuments> } {
  return { documents: listDocuments(input?.folder ? { folder: input.folder } : undefined) };
}

export function ragListMemories(): { memories: ReturnType<typeof listMemories> } {
  return { memories: listMemories() };
}

export function ragListFolders(): { folders: ReturnType<typeof listFolders> } {
  return { folders: listFolders() };
}

export function ragGetDocChunks(input: { documentId: string }): { chunks: Array<{ id: string; chunkIndex: number; content: string }> } {
  return { chunks: listChunksByDocument(input.documentId) };
}

export async function ragUploadFiles(input: {
  paths: string[];
  ifExists?: 'skip' | 'allow' | 'replace';
  folder?: string;
}): Promise<{
  uploaded: Array<{ documentId: string; title: string; chunkCount: number; sourcePath: string }>;
  skipped: Array<{ title: string; sourcePath: string; reason: string }>;
  errors: Array<{ sourcePath: string; error: string }>;
}> {
  const ifExists = input.ifExists ?? 'skip';
  const documents = listDocuments();
  const existingTitles = documents.map((d) => d.title);
  const processedTitles = new Set<string>();

  const uploaded: Array<{ documentId: string; title: string; chunkCount: number; sourcePath: string }> = [];
  const skipped: Array<{ title: string; sourcePath: string; reason: string }> = [];
  const errors: Array<{ sourcePath: string; error: string }> = [];

  for (const rawPath of input.paths) {
    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
    const title = getTitleFromPath(resolvedPath);
    const normalizedTitle = title.trim().toLowerCase();

    if (ifExists !== 'allow' && processedTitles.has(normalizedTitle)) {
      skipped.push({ title, sourcePath: resolvedPath, reason: 'duplicate in batch' });
      continue;
    }

    const hasDuplicate = isDuplicateTitle(existingTitles, title);
    if (hasDuplicate && ifExists === 'skip') {
      skipped.push({ title, sourcePath: resolvedPath, reason: 'document already exists' });
      processedTitles.add(normalizedTitle);
      continue;
    }

    if (hasDuplicate && ifExists === 'replace') {
      documents
        .filter((doc) => doc.title.trim().toLowerCase() === normalizedTitle)
        .forEach((doc) => deleteDocument(doc.id));
      processedTitles.add(normalizedTitle);
    }

    try {
      const buffer = await fs.readFile(resolvedPath);
      const mimeType = inferMimeType(title);
      const text = await extractTextFromBuffer(buffer, mimeType, title);
      const chunks = chunkText(text);

      if (!chunks.length) {
        skipped.push({ title, sourcePath: resolvedPath, reason: 'empty document' });
        processedTitles.add(normalizedTitle);
        continue;
      }

      const doc = createDocument({
        title,
        sourceType: 'upload',
        sourceUri: resolvedPath,
        mimeType,
        folder: input.folder ?? null,
      });

      const chunkRecords = insertChunks(
        doc.id,
        chunks.map((content) => ({ content, tokenCount: estimateTokenCount(content) }))
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

      uploaded.push({ documentId: doc.id, title: doc.title, chunkCount: chunkRecords.length, sourcePath: resolvedPath });
      processedTitles.add(normalizedTitle);
    } catch (error) {
      errors.push({
        sourcePath: resolvedPath,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      processedTitles.add(normalizedTitle);
    }
  }

  return { uploaded, skipped, errors };
}

export function ragUpdateDocFolder(input: { documentId: string; folder: string }): { success: true } {
  updateDocumentFolder(input.documentId, input.folder);
  return { success: true };
}

export function ragBulkUpdateFolders(input: { mappings: Array<{ documentId: string; folder: string }> }): { updated: number; errors: Array<{ documentId: string; error: string }> } {
  const mappings = input.mappings ?? [];
  if (!mappings.length) {
    return { updated: 0, errors: [] };
  }
  bulkUpdateDocumentFolders(mappings.map((m) => ({ documentId: m.documentId, folder: m.folder })));
  return { updated: mappings.length, errors: [] };
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
