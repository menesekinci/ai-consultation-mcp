import { randomUUID } from 'crypto';
import { getDatabase } from '../daemon/database.js';
import { encodeVector } from './embeddings.js';

export interface DocumentRecord {
  id: string;
  title: string;
  sourceType: 'upload' | 'repo_scan' | 'manual';
  sourceUri: string | null;
  mimeType: string | null;
  createdAt: string;
  chunkCount?: number;
}

export interface ChunkRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  createdAt: string;
}

export interface EmbeddingRecord {
  chunkId: string;
  vector: Buffer;
  dim: number;
  model: string;
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  category: 'architecture' | 'backend' | 'db' | 'auth' | 'config' | 'flow' | 'other';
  title: string;
  content: string;
  source: 'repo_scan' | 'manual';
  createdAt: string;
}

export function createDocument(input: {
  title: string;
  sourceType: DocumentRecord['sourceType'];
  sourceUri?: string | null;
  mimeType?: string | null;
}): DocumentRecord {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO documents (id, title, source_type, source_uri, mime_type)
     VALUES (@id, @title, @sourceType, @sourceUri, @mimeType)`
  ).run({
    id,
    title: input.title,
    sourceType: input.sourceType,
    sourceUri: input.sourceUri ?? null,
    mimeType: input.mimeType ?? null,
  });

  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as {
    id: string;
    title: string;
    source_type: DocumentRecord['sourceType'];
    source_uri: string | null;
    mime_type: string | null;
    created_at: string;
  };

  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  };
}

export function insertChunks(documentId: string, chunks: Array<{ content: string; tokenCount: number }>): ChunkRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT INTO chunks (id, document_id, chunk_index, content, token_count)
     VALUES (@id, @documentId, @chunkIndex, @content, @tokenCount)`
  );

  const created: ChunkRecord[] = [];
  const now = new Date().toISOString();

  chunks.forEach((chunk, idx) => {
    const id = randomUUID();
    stmt.run({
      id,
      documentId,
      chunkIndex: idx,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
    });

    created.push({
      id,
      documentId,
      chunkIndex: idx,
      content: chunk.content,
      tokenCount: chunk.tokenCount,
      createdAt: now,
    });
  });

  return created;
}

export function insertEmbedding(params: { chunkId: string; vector: number[]; dim: number; model: string }): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO embeddings (chunk_id, vector, dim, model)
     VALUES (@chunkId, @vector, @dim, @model)`
  ).run({
    chunkId: params.chunkId,
    vector: encodeVector(params.vector),
    dim: params.dim,
    model: params.model,
  });
}

export function listDocuments(): DocumentRecord[] {
  const db = getDatabase();
  const rows = db.prepare(
    `SELECT d.id, d.title, d.source_type, d.source_uri, d.mime_type, d.created_at,
            COUNT(c.id) as chunk_count
     FROM documents d
     LEFT JOIN chunks c ON c.document_id = d.id
     GROUP BY d.id
     ORDER BY d.created_at DESC`
  ).all() as Array<{
    id: string;
    title: string;
    source_type: DocumentRecord['sourceType'];
    source_uri: string | null;
    mime_type: string | null;
    created_at: string;
    chunk_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    chunkCount: row.chunk_count,
  }));
}

export function deleteDocument(documentId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
}

export function listChunksWithEmbeddings(filters?: {
  docIds?: string[];
  docTitles?: string[];
}): Array<{
  chunkId: string;
  documentId: string;
  title: string;
  sourceType: DocumentRecord['sourceType'];
  chunkIndex: number;
  content: string;
  vector: Buffer;
  dim: number;
  model: string;
}> {
  const db = getDatabase();
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters?.docIds?.length) {
    const placeholders = filters.docIds.map((_, idx) => `@docId${idx}`);
    filters.docIds.forEach((id, idx) => {
      params[`docId${idx}`] = id;
    });
    where.push(`d.id IN (${placeholders.join(', ')})`);
  }

  const sql = `
     SELECT c.id as chunkId, c.document_id as documentId, d.title, d.source_type as sourceType,
            c.chunk_index as chunkIndex, c.content, e.vector, e.dim, e.model
     FROM chunks c
     JOIN embeddings e ON e.chunk_id = c.id
     JOIN documents d ON d.id = c.document_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;

  const rows = db.prepare(sql).all(params) as Array<{
    chunkId: string;
    documentId: string;
    title: string;
    sourceType: DocumentRecord['sourceType'];
    chunkIndex: number;
    content: string;
    vector: Buffer;
    dim: number;
    model: string;
  }>;

  if (filters?.docTitles?.length) {
    const needle = filters.docTitles.map((t) => t.toLowerCase());
    return rows.filter((row) => needle.some((n) => row.title.toLowerCase().includes(n)));
  }

  return rows;
}

export function listAllChunks(): Array<{ id: string; content: string }> {
  const db = getDatabase();
  return db.prepare('SELECT id, content FROM chunks').all() as Array<{ id: string; content: string }>;
}

export function listChunksByDocument(documentId: string): Array<{ id: string; chunkIndex: number; content: string }> {
  const db = getDatabase();
  return db
    .prepare('SELECT id, chunk_index as chunkIndex, content FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC')
    .all(documentId) as Array<{ id: string; chunkIndex: number; content: string }>;
}

export function insertMemory(input: Omit<MemoryRecord, 'id' | 'createdAt'>): MemoryRecord {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO memories (id, category, title, content, source)
     VALUES (@id, @category, @title, @content, @source)`
  ).run({
    id,
    category: input.category,
    title: input.title,
    content: input.content,
    source: input.source,
  });

  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as {
    id: string;
    category: MemoryRecord['category'];
    title: string;
    content: string;
    source: MemoryRecord['source'];
    created_at: string;
  };

  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
  };
}

export function listMemories(): MemoryRecord[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all() as Array<{
    id: string;
    category: MemoryRecord['category'];
    title: string;
    content: string;
    source: MemoryRecord['source'];
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
  }));
}

export function clearMemoriesBySource(source: MemoryRecord['source']): void {
  const db = getDatabase();
  db.prepare('DELETE FROM memories WHERE source = ?').run(source);
}
