import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { chunkText, estimateTokenCount } from '../../rag/chunking.js';
import { embedTexts } from '../../rag/embeddings.js';
import { createDocument, deleteDocument, insertChunks, insertEmbedding, listDocuments, listMemories, listAllChunks, listChunksByDocument } from '../../rag/storage.js';
import { retrieveContext, toSnippet } from '../../rag/retrieval.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

async function extractTextFromBuffer(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();

  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }

  return buffer.toString('utf8');
}

router.get('/documents', (_req: Request, res: Response) => {
  try {
    const documents = listDocuments();
    const memories = listMemories();
    res.json({ documents, memoryCount: memories.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list documents', message: error instanceof Error ? error.message : 'Unknown error' });
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
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const results: Array<{ documentId: string; title: string; chunkCount: number }> = [];

    for (const file of files) {
      const title = file.originalname;
      const mimeType = file.mimetype || 'application/octet-stream';

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
    const documents = listDocuments();
    if (!documents.length) {
      res.json({ reindexed: 0 });
      return;
    }

    // Simple reindex: reload all chunks and re-embed
    const allChunks = listAllChunks();
    const texts = allChunks.map((c) => c.content);
    const embeddingResult = await embedTexts(texts);

    allChunks.forEach((chunk, idx) => {
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

    res.json({ reindexed: allChunks.length });
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
    const topK = typeof req.body?.topK === 'number' ? req.body.topK : undefined;
    const minScore = typeof req.body?.minScore === 'number' ? req.body.minScore : undefined;

    const result = await retrieveContext(query, { docIds, docTitles, topK, minScore });
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
    const category = req.body?.category as string | undefined;
    const title = (req.body?.title as string | undefined)?.trim();
    const content = (req.body?.content as string | undefined)?.trim();

    if (!title || !content || !category) {
      res.status(400).json({ error: 'category, title, and content are required' });
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
