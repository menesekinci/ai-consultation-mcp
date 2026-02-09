import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { Socket } from 'socket.io-client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTitleFromPath, isDuplicateTitle } from '../../rag/dedupe.js';
import { inferMimeType } from '../../rag/ingest.js';
import { CONSULTATION_MODES } from '../../config/index.js';
import { ensureDaemonRunning, openWebUI as openProxyWebUI } from '../../proxy/daemon-client.js';
import {
  handleConsultAgent,
  handleContinueConversation,
  handleEndConversation,
} from '../../proxy/bridge.js';

export interface DaemonClient {
  getSocket: () => Promise<Socket>;
}

async function callDaemonRag(pathname: string, options: { method?: string; body?: unknown } = {}) {
  const lock = await ensureDaemonRunning();
  const url = `http://127.0.0.1:${lock.port}/api/rag${pathname}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-daemon-token': lock.token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `RAG request failed: ${res.status}`);
  }
  return res.json();
}

async function callDaemonRagUpload(input: {
  paths: string[];
  ifExists?: 'skip' | 'allow' | 'replace';
  folder?: string;
}) {
  const ifExists = input.ifExists ?? 'skip';
  const lock = await ensureDaemonRunning();
  const baseUrl = `http://127.0.0.1:${lock.port}/api/rag`;

  const listRes = await fetch(`${baseUrl}/documents`, {
    headers: {
      'Content-Type': 'application/json',
      'x-daemon-token': lock.token,
    },
  });
  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(text || `RAG list failed: ${listRes.status}`);
  }
  const listData = await listRes.json();
  const documents = Array.isArray(listData?.documents) ? listData.documents : [];
  const existingTitles = documents.map((d: { title: string }) => d.title);

  const processedTitles = new Set<string>();
  const skipped: Array<{ title: string; sourcePath: string; reason: string }> = [];
  const errors: Array<{ sourcePath: string; error: string }> = [];
  const queued: Array<{ title: string; sourcePath: string }> = [];
  const form = new FormData();

  for (const rawPath of input.paths) {
    const resolvedPath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(process.cwd(), rawPath);
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
      const matching = documents.filter(
        (doc: { id: string; title: string }) =>
          doc.title.trim().toLowerCase() === normalizedTitle
      );
      for (const doc of matching) {
        const delRes = await fetch(`${baseUrl}/documents/${doc.id}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-daemon-token': lock.token,
          },
        });
        if (!delRes.ok) {
          const text = await delRes.text();
          errors.push({
            sourcePath: resolvedPath,
            error: text || `Failed to delete existing document (${delRes.status})`,
          });
        }
      }
      processedTitles.add(normalizedTitle);
    }

    try {
      const buffer = await fs.readFile(resolvedPath);
      const mimeType = inferMimeType(title);
      form.append('files', new Blob([buffer], { type: mimeType }), title);
      if (input.folder) {
        form.set('folder', input.folder);
      }
      queued.push({ title, sourcePath: resolvedPath });
      if (ifExists !== 'allow') {
        processedTitles.add(normalizedTitle);
      }
    } catch (error) {
      errors.push({
        sourcePath: resolvedPath,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      processedTitles.add(normalizedTitle);
    }
  }

  if (queued.length === 0) {
    return { uploaded: [], skipped, errors };
  }

  const uploadRes = await fetch(`${baseUrl}/upload`, {
    method: 'POST',
    headers: {
      'x-daemon-token': lock.token,
    },
    body: form,
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text();
    throw new Error(text || `RAG upload failed: ${uploadRes.status}`);
  }
  const uploadData = await uploadRes.json();
  const uploadedDocs = Array.isArray(uploadData?.documents)
    ? uploadData.documents
    : [];
  const remaining = [...queued];
  const uploaded = uploadedDocs.map(
    (doc: { documentId: string; title: string; chunkCount: number }) => {
      const matchIndex = remaining.findIndex((item) => item.title === doc.title);
      const match = matchIndex >= 0 ? remaining.splice(matchIndex, 1)[0] : remaining.shift();
      return {
        documentId: doc.documentId,
        title: doc.title,
        chunkCount: doc.chunkCount,
        sourcePath: match?.sourcePath ?? '',
      };
    }
  );

  return { uploaded, skipped, errors };
}

function toErrorResult(error: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
    ],
    isError: true,
  };
}

function toSuccessResult(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}

export function registerProxyTools(server: McpServer, daemonClient: DaemonClient): void {
  server.tool(
    'consult_agent',
    'Get a second opinion from another AI model. The daemon provides real-time sync across all connected tools.',
    {
      question: z
        .string()
        .describe('The problem, approach, or decision you want a second opinion on'),
      mode: z
        .enum(CONSULTATION_MODES)
        .optional()
        .describe(
          'Consultation focus: debug, analyzeCode, reviewArchitecture, validatePlan, explainConcept, or general'
        ),
      context: z
        .string()
        .optional()
        .describe('Supporting context: code snippets, error messages, your current approach'),
      provider: z.string().optional().describe('AI provider (e.g. deepseek, openai)'),
      model: z.string().optional().describe('Specific model name'),
      useRag: z.boolean().optional().describe('Include RAG context in consultation'),
      docIds: z.array(z.string().uuid()).optional().describe('Restrict RAG search to these document IDs'),
      docTitles: z.array(z.string()).optional().describe('Restrict RAG search to matching document titles'),
    },
    async (args) => {
      try {
        // Try REST endpoint first
        const lock = await ensureDaemonRunning();
        const url = `http://127.0.0.1:${lock.port}/api/consult`;
        let message = args.question;
        if (args.context) {
          message = `${args.question}\n\nContext:\n${args.context}`;
        }
        if (args.mode) {
          message = `[Mode: ${args.mode}] ${message}`;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-daemon-token': lock.token,
          },
          body: JSON.stringify({
            message,
            provider: args.provider,
            model: args.model,
            useRag: args.useRag ?? true,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `Consult request failed: ${res.status}`);
        }
        const result = await res.json();
        return toSuccessResult(result);
      } catch (error) {
        // Fallback to socket
        try {
          const socket = await daemonClient.getSocket();
          openProxyWebUI(socket).catch(() => {});
          const result = await handleConsultAgent(socket, args);
          return toSuccessResult(result);
        } catch (fallbackError) {
          return toErrorResult(error);
        }
      }
    }
  );

  server.tool(
    'continue_conversation',
    'Continue a multi-turn consultation',
    {
      conversationId: z.string().uuid().describe('The conversation ID from a previous consult_agent call'),
      message: z.string().describe('Your follow-up question or response'),
      docIds: z.array(z.string().uuid()).optional().describe('Restrict RAG search to these document IDs'),
      docTitles: z.array(z.string()).optional().describe('Restrict RAG search to matching document titles'),
    },
    async (args) => {
      try {
        const socket = await daemonClient.getSocket();
        openProxyWebUI(socket).catch(() => {});
        const result = await handleContinueConversation(socket, args);
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'end_conversation',
    'End a consultation session and archive it',
    {
      conversationId: z.string().uuid().describe('The conversation ID to end and archive'),
    },
    async (args) => {
      try {
        const socket = await daemonClient.getSocket();
        openProxyWebUI(socket).catch(() => {});
        const result = await handleEndConversation(socket, args);
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_search',
    'Search RAG documents with optional filters',
    {
      query: z.string().describe('Search query'),
      docIds: z.array(z.string().uuid()).optional().describe('Restrict to document IDs'),
      docTitles: z.array(z.string()).optional().describe('Restrict to document titles'),
      folder: z.string().optional().describe('Restrict to folder'),
      topK: z.number().optional().describe('Number of top results'),
      minScore: z.number().optional().describe('Minimum similarity score'),
    },
    async (args) => {
      try {
        const result = await callDaemonRag('/search', { method: 'POST', body: args });
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_upload_files',
    'Upload local files to RAG using file paths',
    {
      paths: z.array(z.string()).min(1).describe('File paths to upload'),
      ifExists: z
        .enum(['skip', 'allow', 'replace'])
        .optional()
        .describe('Behavior when a document with the same title exists'),
      folder: z.string().optional().describe('Folder name'),
    },
    async (args) => {
      try {
        const result = await callDaemonRagUpload(args);
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_list_docs',
    'List available RAG documents',
    {
      folder: z.string().optional().describe('Restrict to folder'),
    },
    async (args) => {
      try {
        const suffix = args?.folder ? `?folder=${encodeURIComponent(args.folder)}` : '';
        const result = await callDaemonRag(`/documents${suffix}`);
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_list_folders',
    'List available RAG folders',
    {},
    async () => {
      try {
        const result = await callDaemonRag('/folders');
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_update_doc_folder',
    'Update a document folder',
    {
      documentId: z.string().uuid().describe('Document ID'),
      folder: z.string().describe('Folder name'),
    },
    async (args) => {
      try {
        const result = await callDaemonRag(`/documents/${args.documentId}/folder`, {
          method: 'PATCH',
          body: { folder: args.folder },
        });
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_bulk_update_folders',
    'Bulk update document folders',
    {
      mappings: z
        .array(z.object({ documentId: z.string().uuid(), folder: z.string() }))
        .describe('Folder mappings'),
    },
    async (args) => {
      try {
        const result = await callDaemonRag('/documents/folders', {
          method: 'POST',
          body: { mappings: args.mappings },
        });
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_list_memories',
    'List structured memory notes',
    {},
    async () => {
      try {
        const result = await callDaemonRag('/memories');
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_add_memory',
    'Add a memory note that will be embedded for RAG search',
    {
      title: z.string().describe('Short memory title'),
      content: z.string().describe('Memory content'),
      category: z.enum(['architecture', 'backend', 'db', 'auth', 'config', 'flow', 'other']).optional().describe('Category (defaults to "other")'),
    },
    async (args) => {
      try {
        const result = await callDaemonRag('/memory', { method: 'POST', body: args });
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );

  server.tool(
    'rag_get_doc_chunks',
    'Get all chunks for a document',
    { documentId: z.string().uuid().describe('Document ID') },
    async (args) => {
      try {
        const result = await callDaemonRag(`/documents/${args.documentId}/chunks`);
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
