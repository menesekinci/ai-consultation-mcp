#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getConfigManager, CONSULTATION_MODES } from './config/index.js';
import { logger } from './utils/index.js';
import {
  consultAgent,
  continueConversation,
  endConversation,
  ragSearch,
  ragListDocs,
  ragListMemories,
  ragGetDocChunks,
  ragListFolders,
  ragUpdateDocFolder,
  ragBulkUpdateFolders,
  ragUploadFiles,
} from './server/index.js';
import { initializeProviders } from './providers/index.js';
import { startConfigUI, openWebUI } from './api/index.js';
import { installToAllTools, printInstallSummary, uninstallFromAllTools, printUninstallSummary, SUPPORTED_TOOLS } from './installer/index.js';

// Proxy imports for new architecture
import { createDaemonClient, openWebUI as openProxyWebUI, ensureDaemonRunning } from './proxy/daemon-client.js';
import {
  handleConsultAgent,
  handleContinueConversation,
  handleEndConversation,
} from './proxy/bridge.js';
import fs from 'fs/promises';
import path from 'path';
import { getTitleFromPath, isDuplicateTitle } from './rag/dedupe.js';
import { inferMimeType } from './rag/ingest.js';

/**
 * Parse CLI arguments
 */
function parseArgs(): { mode: 'mcp' | 'config' | 'install' | 'uninstall' | 'daemon' | 'legacy'; port?: number } {
  const args = process.argv.slice(2);

  // Check for uninstall mode
  if (args.includes('--uninstall') || args.includes('uninstall') || args.includes('-u')) {
    return { mode: 'uninstall' };
  }

  // Check for install mode
  if (args.includes('--install') || args.includes('install') || args.includes('-i')) {
    return { mode: 'install' };
  }

  // Check for daemon mode (start daemon directly)
  if (args.includes('--daemon') || args.includes('daemon') || args.includes('-d')) {
    return { mode: 'daemon' };
  }

  // Check for legacy mode (old standalone behavior)
  if (args.includes('--legacy') || args.includes('--standalone')) {
    return { mode: 'legacy' };
  }

  // Check for config mode
  if (args.includes('--config') || args.includes('config') || args.includes('-c')) {
    // Parse port if provided
    const portIndex = args.findIndex((a) => a === '--port' || a === '-p');
    let port: number | undefined;
    if (portIndex !== -1 && args[portIndex + 1]) {
      port = parseInt(args[portIndex + 1], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('Invalid port number. Using default.');
        port = undefined;
      }
    }
    return { mode: 'config', port };
  }

  // Check for help
  if (args.includes('--help') || args.includes('-h')) {
    const toolNames = SUPPORTED_TOOLS.map((t) => t.name).join(', ');
    console.log(`
AI Consultation MCP - Get second opinions from DeepSeek Reasoner

Usage:
  npx ai-consultation-mcp             Start MCP proxy (connects to central daemon)
  npx ai-consultation-mcp --install   Auto-detect & install to all AI tools
  npx ai-consultation-mcp --uninstall Remove MCP from all AI tools
  npx ai-consultation-mcp --config    Open configuration UI in browser
  npx ai-consultation-mcp --daemon    Start the central daemon directly
  npx ai-consultation-mcp --legacy    Use legacy standalone mode (no daemon)
  npx ai-consultation-mcp --help      Show this help message

Options:
  --install, -i        Auto-detect installed AI tools and add MCP to each
  --uninstall, -u      Remove MCP configuration from all AI tools
  --config, -c         Open configuration UI to manage API keys
  --daemon, -d         Start central daemon (auto-started by proxy if needed)
  --legacy             Use legacy standalone mode (bypasses daemon)
  --port <number>, -p  Set port for config UI (default: 3456)
  --help, -h           Show this help message

Supported AI Tools:
  ${toolNames}

Quick Start:
  1. npx ai-consultation-mcp --install  (auto-detects all tools)
  2. Restart your AI tools to load the MCP
  3. npx ai-consultation-mcp --config   (configure API key)
  4. Start using in any configured tool!

Supported Models:
  - deepseek-reasoner (default) - Deep reasoning for complex tasks
  - deepseek-chat - Fast responses for simple queries
  - gpt-5.2, gpt-5.2-pro - OpenAI models (requires API key)

Consultation Modes:
  - debug           - Systematic error analysis and debugging
  - analyzeCode     - Code review for bugs, security, performance
  - reviewArchitecture - System design and architecture decisions
  - validatePlan    - Implementation plan review and validation
  - explainConcept  - Learn concepts with examples and analogies
  - general         - General second opinion (default)

Architecture:
  The MCP now uses a central daemon architecture for real-time sync:
  - Daemon: Central server with SQLite storage and WebSocket
  - Proxy: Lightweight stdio ↔ WebSocket bridge for each IDE
  - Web UI: Real-time updates across all connected tools
`);
    process.exit(0);
  }

  return { mode: 'mcp' };
}

/**
 * Start proxy MCP server (connects to daemon)
 */
async function startProxyMode(): Promise<void> {
  console.error('[MCP] Starting AI Consultation MCP Proxy...');

  const daemonClient = createDaemonClient();

  const server = new McpServer({
    name: 'ai-consultation',
    version: '2.1.0',
  });

  // Register consult_agent tool
  server.tool(
    'consult_agent',
    'Get a second opinion from another AI model. The daemon provides real-time sync across all connected tools.',
    {
      question: z.string().describe('The problem, approach, or decision you want a second opinion on'),
      mode: z
        .enum(CONSULTATION_MODES)
        .optional()
        .describe('Consultation focus: debug, analyzeCode, reviewArchitecture, validatePlan, explainConcept, or general'),
      context: z
        .string()
        .optional()
        .describe('Supporting context: code snippets, error messages, your current approach'),
      docIds: z.array(z.string().uuid()).optional().describe('Restrict RAG search to these document IDs'),
      docTitles: z.array(z.string()).optional().describe('Restrict RAG search to matching document titles'),
    },
    async (args) => {
      try {
        const socket = await daemonClient.getSocket();
        openProxyWebUI(socket).catch(() => {});
        const result = await handleConsultAgent(socket, args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  // Register continue_conversation tool
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
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  // Register end_conversation tool
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
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  async function callDaemonRag(path: string, options: { method?: string; body?: unknown } = {}) {
    const lock = await ensureDaemonRunning();
    const url = `http://127.0.0.1:${lock.port}/api/rag${path}`;
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

  async function callDaemonRagUpload(input: { paths: string[]; ifExists?: 'skip' | 'allow' | 'replace'; folder?: string }) {
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
        const matching = documents.filter((doc: { id: string; title: string }) => doc.title.trim().toLowerCase() === normalizedTitle);
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
            errors.push({ sourcePath: resolvedPath, error: text || `Failed to delete existing document (${delRes.status})` });
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
        errors.push({ sourcePath: resolvedPath, error: error instanceof Error ? error.message : 'Unknown error' });
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
    const uploadedDocs = Array.isArray(uploadData?.documents) ? uploadData.documents : [];
    const remaining = [...queued];
    const uploaded = uploadedDocs.map((doc: { documentId: string; title: string; chunkCount: number }) => {
      const matchIndex = remaining.findIndex((item) => item.title === doc.title);
      const match = matchIndex >= 0 ? remaining.splice(matchIndex, 1)[0] : remaining.shift();
      return {
        documentId: doc.documentId,
        title: doc.title,
        chunkCount: doc.chunkCount,
        sourcePath: match?.sourcePath ?? '',
      };
    });

    return { uploaded, skipped, errors };
  }

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
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_upload_files',
    'Upload local files to RAG using file paths',
    {
      paths: z.array(z.string()).min(1).describe('File paths to upload'),
      ifExists: z.enum(['skip', 'allow', 'replace']).optional().describe('Behavior when a document with the same title exists'),
      folder: z.string().optional().describe('Folder name'),
    },
    async (args) => {
      try {
        const result = await callDaemonRagUpload(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_bulk_update_folders',
    'Bulk update document folders',
    {
      mappings: z.array(z.object({ documentId: z.string().uuid(), folder: z.string() })).describe('Folder mappings'),
    },
    async (args) => {
      try {
        const result = await callDaemonRag('/documents/folders', { method: 'POST', body: { mappings: args.mappings } });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_add_memory',
    'Add a memory note that will be embedded for RAG search',
    {
      category: z.enum(['architecture', 'backend', 'db', 'auth', 'config', 'flow', 'other']),
      title: z.string().describe('Short memory title'),
      content: z.string().describe('Memory content'),
    },
    async (args) => {
      try {
        const result = await callDaemonRag('/memory', { method: 'POST', body: args });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Proxy connected and ready');
}

/**
 * Start legacy standalone MCP server (no daemon)
 */
async function startLegacyMode(): Promise<void> {
  const configManager = getConfigManager();
  await configManager.init();
  await initializeProviders();

  logger.info('Starting Agent Consultation MCP Server (Legacy Mode)');

  const server = new McpServer({
    name: 'agent-consultation',
    version: '2.1.0',
  });

  server.tool(
    'consult_agent',
    'Get a second opinion from another AI model (legacy standalone mode)',
    {
      question: z.string().describe('The problem, approach, or decision you want a second opinion on'),
      mode: z.enum(CONSULTATION_MODES).optional().describe('Consultation focus'),
      context: z.string().optional().describe('Supporting context'),
      docIds: z.array(z.string().uuid()).optional().describe('Restrict RAG search to these document IDs'),
      docTitles: z.array(z.string()).optional().describe('Restrict RAG search to matching document titles'),
    },
    async (args) => {
      openWebUI().catch(() => {});
      try {
        const result = await consultAgent(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'continue_conversation',
    'Continue a multi-turn consultation (legacy mode)',
    {
      conversationId: z.string().uuid().describe('The conversation ID'),
      message: z.string().describe('Your follow-up question'),
      docIds: z.array(z.string().uuid()).optional().describe('Restrict RAG search to these document IDs'),
      docTitles: z.array(z.string()).optional().describe('Restrict RAG search to matching document titles'),
    },
    async (args) => {
      openWebUI().catch(() => {});
      try {
        const result = await continueConversation(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'end_conversation',
    'End a consultation session (legacy mode)',
    {
      conversationId: z.string().uuid().describe('The conversation ID to end'),
    },
    async (args) => {
      openWebUI().catch(() => {});
      try {
        const result = await endConversation(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
        const result = await ragSearch(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_upload_files',
    'Upload local files to RAG using file paths',
    {
      paths: z.array(z.string()).min(1).describe('File paths to upload'),
      ifExists: z.enum(['skip', 'allow', 'replace']).optional().describe('Behavior when a document with the same title exists'),
      folder: z.string().optional().describe('Folder name'),
    },
    async (args) => {
      openWebUI().catch(() => {});
      try {
        const result = await ragUploadFiles(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
        const result = ragListDocs(args?.folder ? { folder: args.folder } : undefined);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_list_folders',
    'List available RAG folders',
    {},
    async () => {
      try {
        const result = ragListFolders();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
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
      openWebUI().catch(() => {});
      try {
        const result = ragUpdateDocFolder(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_bulk_update_folders',
    'Bulk update document folders',
    {
      mappings: z.array(z.object({ documentId: z.string().uuid(), folder: z.string() })).describe('Folder mappings'),
    },
    async (args) => {
      openWebUI().catch(() => {});
      try {
        const result = ragBulkUpdateFolders(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_list_memories',
    'List structured memory notes',
    {},
    async () => {
      try {
        const result = ragListMemories();
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'rag_get_doc_chunks',
    'Get all chunks for a document',
    { documentId: z.string().uuid().describe('Document ID') },
    async (args) => {
      try {
        const result = ragGetDocChunks(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP Server connected and ready (Legacy Mode)');
}

/**
 * Initialize and start the MCP server
 */
async function main(): Promise<void> {
  const { mode, port } = parseArgs();

  // Install mode
  if (mode === 'install') {
    console.log('🔧 AI Consultation MCP - Multi-Tool Installer\n');
    console.log('Scanning for installed AI tools...\n');

    const summary = installToAllTools();
    printInstallSummary(summary);

    if (summary.installed.length > 0 || summary.skipped.length > 0) {
      console.log('🌐 Starting configuration UI...\n');
      try {
        await startConfigUI({ openBrowser: true });
      } catch (error) {
        console.log('\n⚠️  Could not start configuration UI');
        if (error instanceof Error) {
          console.log(`   Error: ${error.message}`);
        }
        console.log('\n💡 To configure API keys later, run:');
        console.log('   npx ai-consultation-mcp --config\n');
        process.exit(0);
      }
    } else {
      console.log('\n💡 No supported AI tools found.');
      console.log('   Install one of the supported tools and run this installer again.\n');
      process.exit(0);
    }
    return;
  }

  // Uninstall mode
  if (mode === 'uninstall') {
    console.log('🧹 AI Consultation MCP - Uninstaller\n');
    console.log('Scanning for installed AI tools...\n');

    const summary = uninstallFromAllTools();
    printUninstallSummary(summary);
    process.exit(0);
  }

  // Daemon mode - start daemon directly
  if (mode === 'daemon') {
    // Dynamically import daemon to avoid circular deps
    const { initDatabase } = await import('./daemon/database.js');
    const { createDaemonServer } = await import('./daemon/server.js');
    const { acquireLock, removeLockFile, isDaemonRunning, runMigration } = await import('./daemon/utils/index.js');

    const existingPort = isDaemonRunning();
    if (existingPort) {
      console.log(`Daemon already running on port ${existingPort}`);
      process.exit(0);
    }

    const daemonPort = 3456;
    if (!acquireLock(daemonPort)) {
      console.error('Failed to acquire lock');
      process.exit(1);
    }

    try {
      initDatabase();
      runMigration();
      const server = createDaemonServer(daemonPort);
      await server.start();
      console.log(`Daemon started on http://127.0.0.1:${daemonPort}`);
    } catch (error) {
      console.error('Failed to start daemon:', error);
      removeLockFile();
      process.exit(1);
    }
    return;
  }

  // Config UI mode
  if (mode === 'config') {
    try {
      await startConfigUI({ port, openBrowser: true });
    } catch (error) {
      console.error('Failed to start config UI:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  // Legacy mode
  if (mode === 'legacy') {
    await startLegacyMode();
    return;
  }

  // Default: Proxy mode (connects to daemon)
  await startProxyMode();
}

// Handle process signals
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down');
  process.exit(0);
});

// Start the server
main().catch((error) => {
  logger.error('Failed to start MCP server', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exit(1);
});
