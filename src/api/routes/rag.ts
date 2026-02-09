import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { chunkText, estimateTokenCount } from '../../rag/chunking.js';
import { embedTexts, checkEmbedServiceHealth, getEmbedUrl } from '../../rag/embeddings.js';
import {
  createDocument,
  deleteDocument,
  insertChunks,
  insertEmbedding,
  listDocuments,
  listMemories,
  listAllChunks,
  listChunksByDocument,
  listFolders,
  updateDocumentFolder,
  bulkUpdateDocumentFolders,
} from '../../rag/storage.js';
import { retrieveContext, toSnippet } from '../../rag/retrieval.js';
import { extractTextFromBuffer } from '../../rag/ingest.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/documents', (req: Request, res: Response) => {
  try {
    const folder = typeof req.query.folder === 'string' ? req.query.folder : undefined;
    const documents = listDocuments(folder ? { folder } : undefined);
    const memories = listMemories();
    res.json({ documents, memoryCount: memories.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list documents', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/folders', (_req: Request, res: Response) => {
  try {
    const folders = listFolders();
    res.json({ folders });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list folders', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/memories', (_req: Request, res: Response) => {
  try {
    const memories = listMemories();
    res.json({ memories });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list memories', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/upload', upload.array('files'), async (req: Request, res: Response) => {
  try {
    const embedHealth = await checkEmbedServiceHealth();
    if (!embedHealth.available) {
      res.status(503).json({ error: 'Embedding service unavailable', url: getEmbedUrl() });
      return;
    }
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const results: Array<{ documentId: string; title: string; chunkCount: number }> = [];

    for (const file of files) {
      const title = file.originalname;
      const mimeType = file.mimetype || 'application/octet-stream';
      const folder = typeof (req.body as Record<string, unknown> | undefined)?.folder === 'string'
        ? String((req.body as Record<string, unknown>).folder)
        : null;

      const text = await extractTextFromBuffer(file.buffer, mimeType, file.originalname);
      const chunks = chunkText(text);

      if (!chunks.length) {
        continue;
      }

      const doc = createDocument({
        title,
        sourceType: 'upload',
        sourceUri: file.originalname,
        mimeType,
        folder,
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

      results.push({ documentId: doc.id, title: doc.title, chunkCount: chunkRecords.length });
    }

    if (!results.length) {
      res.status(400).json({ error: 'Documents are empty after processing' });
      return;
    }

    res.json({ documents: results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to upload document', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.delete('/documents/:id', (req: Request, res: Response) => {
  try {
    deleteDocument(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete document', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.patch('/documents/:id/folder', (req: Request, res: Response) => {
  try {
    const folder = typeof req.body?.folder === 'string' ? req.body.folder : null;
    updateDocumentFolder(String(req.params.id), folder);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update folder', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/documents/folders', (req: Request, res: Response) => {
  try {
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    if (!mappings.length) {
      res.status(400).json({ error: 'Mappings are required' });
      return;
    }
    const normalized = mappings
      .filter((m: any) => typeof m?.documentId === 'string' && typeof m?.folder === 'string')
      .map((m: any) => ({ documentId: m.documentId, folder: m.folder }));
    if (!normalized.length) {
      res.status(400).json({ error: 'Valid mappings are required' });
      return;
    }
    const result = bulkUpdateDocumentFolders(normalized);
    res.json({ updated: result.updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update folders', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/documents/:id/chunks', (req: Request, res: Response) => {
  try {
    const chunks = listChunksByDocument(String(req.params.id));
    res.json({ chunks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch chunks', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/reindex', async (_req: Request, res: Response) => {
  try {
    const embedHealth = await checkEmbedServiceHealth();
    if (!embedHealth.available) {
      res.status(503).json({ error: 'Embedding service unavailable', url: getEmbedUrl() });
      return;
    }
    const documents = listDocuments();
    if (!documents.length) {
      res.json({ reindexed: 0 });
      return;
    }

    // Batch reindex: process chunks in batches of 50
    const allChunks = listAllChunks();
    const BATCH_SIZE = 50;
    let batches = 0;

    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content);
      const embeddingResult = await embedTexts(texts);

      batch.forEach((chunk, idx) => {
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
      batches++;
    }

    res.json({ reindexed: allChunks.length, batches });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reindex', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/search', async (req: Request, res: Response) => {
  try {
    const query = (req.body?.query as string | undefined)?.trim();
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const docIds = Array.isArray(req.body?.docIds) ? req.body.docIds : undefined;
    const docTitles = Array.isArray(req.body?.docTitles) ? req.body.docTitles : undefined;
    const folder = typeof req.body?.folder === 'string' ? req.body.folder : undefined;
    const topK = typeof req.body?.topK === 'number' ? req.body.topK : undefined;
    const minScore = typeof req.body?.minScore === 'number' ? req.body.minScore : undefined;

    const result = await retrieveContext(query, { docIds, docTitles, topK, minScore, folder });
    res.json({
      query,
      contextPreview: result.context,
      hits: result.hits.map((hit) => ({
        score: hit.score,
        title: hit.title,
        sourceType: hit.sourceType,
        chunkIndex: hit.chunkIndex,
        snippet: toSnippet(hit.content),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to search', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/memory', async (req: Request, res: Response) => {
  try {
    const embedHealth = await checkEmbedServiceHealth();
    if (!embedHealth.available) {
      res.status(503).json({ error: 'Embedding service unavailable', url: getEmbedUrl() });
      return;
    }
    const category = (req.body?.category as string | undefined) || 'other';
    const title = (req.body?.title as string | undefined)?.trim();
    const content = (req.body?.content as string | undefined)?.trim();

    if (!title || !content) {
      res.status(400).json({ error: 'title and content are required' });
      return;
    }

    const { insertMemory } = await import('../../rag/storage.js');
    const memory = insertMemory({
      category: category as any,
      title,
      content,
      source: 'manual',
    });

    const doc = createDocument({
      title: `Memory: ${title}`,
      sourceType: 'manual',
      sourceUri: 'memory',
      mimeType: 'text/plain',
    });

    const chunks = chunkText(content);
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

    res.json({ memory, documentId: doc.id, chunkCount: chunkRecords.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add memory', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/test', async (req: Request, res: Response) => {
  try {
    const query = (req.body?.query as string | undefined)?.trim();
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const result = await retrieveContext(query);
    res.json({ query, context: result.context, hits: result.hits });
  } catch (error) {
    res.status(500).json({ error: 'Failed to run RAG test', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export { router as ragRoutes };
