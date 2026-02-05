import { randomUUID } from 'crypto';
import { getDatabase } from '../daemon/database.js';
import { encodeVector } from './embeddings.js';

export interface DocumentRecord {
  id: string;
  title: string;
  sourceType: 'upload' | 'manual';
  sourceUri: string | null;
  mimeType: string | null;
  folder?: string | null;
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
  source: 'manual';
  createdAt: string;
}

export function createDocument(input: {
  title: string;
  sourceType: DocumentRecord['sourceType'];
  sourceUri?: string | null;
  mimeType?: string | null;
  folder?: string | null;
}): DocumentRecord {
  const db = getDatabase();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO documents (id, title, source_type, source_uri, mime_type, folder)
     VALUES (@id, @title, @sourceType, @sourceUri, @mimeType, @folder)`
  ).run({
    id,
    title: input.title,
    sourceType: input.sourceType,
    sourceUri: input.sourceUri ?? null,
    mimeType: input.mimeType ?? null,
    folder: input.folder ?? null,
  });

  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as {
    id: string;
    title: string;
    source_type: DocumentRecord['sourceType'];
    source_uri: string | null;
    mime_type: string | null;
    folder: string | null;
    created_at: string;
  };

  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    mimeType: row.mime_type,
    folder: row.folder,
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

export function listDocuments(filter?: { folder?: string }): DocumentRecord[] {
  const db = getDatabase();
  const params: Record<string, unknown> = {};
  const where: string[] = [];
  if (filter?.folder) {
    where.push('d.folder = @folder');
    params.folder = filter.folder;
  }
  const rows = db.prepare(
    `SELECT d.id, d.title, d.source_type, d.source_uri, d.mime_type, d.folder, d.created_at,
            COUNT(c.id) as chunk_count
     FROM documents d
     LEFT JOIN chunks c ON c.document_id = d.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY d.id
     ORDER BY d.created_at DESC`
  ).all(params) as Array<{
    id: string;
    title: string;
    source_type: DocumentRecord['sourceType'];
    source_uri: string | null;
    mime_type: string | null;
    folder: string | null;
    created_at: string;
    chunk_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    mimeType: row.mime_type,
    folder: row.folder,
    createdAt: row.created_at,
    chunkCount: row.chunk_count,
  }));
}

export function listFolders(): Array<{ name: string; count: number }> {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT folder as name, COUNT(*) as count
       FROM documents
       WHERE folder IS NOT NULL
       GROUP BY folder
       ORDER BY folder ASC`
    )
    .all() as Array<{ name: string; count: number }>;
}

export function updateDocumentFolder(documentId: string, folder: string | null): void {
  const db = getDatabase();
  db.prepare('UPDATE documents SET folder = @folder WHERE id = @id').run({ id: documentId, folder });
}

export function bulkUpdateDocumentFolders(mappings: Array<{ documentId: string; folder: string | null }>): {
  updated: number;
} {
  const db = getDatabase();
  const stmt = db.prepare('UPDATE documents SET folder = @folder WHERE id = @documentId');
  const update = db.transaction((rows: Array<{ documentId: string; folder: string | null }>) => {
    for (const row of rows) {
      stmt.run({ documentId: row.documentId, folder: row.folder });
    }
  });
  update(mappings);
  return { updated: mappings.length };
}

export function deleteDocument(documentId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
}

export function listChunksWithEmbeddings(filters?: {
  docIds?: string[];
  docTitles?: string[];
  folder?: string;
}): Array<{
  chunkId: string;
  documentId: string;
  title: string;
  sourceType: DocumentRecord['sourceType'];
  folder: string | null;
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
  if (filters?.folder) {
    where.push('d.folder = @folder');
    params.folder = filters.folder;
  }

  const sql = `
     SELECT c.id as chunkId, c.document_id as documentId, d.title, d.source_type as sourceType, d.folder as folder,
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
    folder: string | null;
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
