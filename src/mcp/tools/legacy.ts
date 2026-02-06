import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
} from '../../server/index.js';
import { openWebUI } from '../../api/index.js';
import { CONSULTATION_MODES } from '../../config/index.js';

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

export function registerLegacyTools(server: McpServer): void {
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
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
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
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
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
        const result = await ragSearch(args);
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
      openWebUI().catch(() => {});
      try {
        const result = await ragUploadFiles(args);
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
        const result = ragListDocs(args?.folder ? { folder: args.folder } : undefined);
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
        const result = ragListFolders();
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
      openWebUI().catch(() => {});
      try {
        const result = ragUpdateDocFolder(args);
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
      openWebUI().catch(() => {});
      try {
        const result = ragBulkUpdateFolders(args);
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
        const result = ragListMemories();
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
        const result = ragGetDocChunks(args);
        return toSuccessResult(result);
      } catch (error) {
        return toErrorResult(error);
      }
    }
  );
}
