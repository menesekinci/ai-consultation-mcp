#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createDaemonClient } from './daemon-client.js';
import {
  handleConsultAgent,
  handleContinueConversation,
  handleEndConversation,
} from './bridge.js';

const CONSULTATION_MODES = [
  'debug',
  'analyzeCode',
  'reviewArchitecture',
  'validatePlan',
  'explainConcept',
  'general',
] as const;

/**
 * Main proxy entry point
 */
async function main(): Promise<void> {
  console.error('[Proxy] Starting AI Consultation MCP Proxy...');

  // Create daemon client
  const daemonClient = createDaemonClient();

  // Create MCP server
  const server = new McpServer({
    name: 'ai-consultation',
    version: '2.1.0',
  });

  // Register consult_agent tool
  server.tool(
    'consult_agent',
    'Get a second opinion from another AI model to enrich your perspective. Use this when you want critical feedback, alternative approaches, or to challenge your assumptions.',
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
    },
    async (args) => {
      try {
        const socket = await daemonClient.getSocket();
        const result = await handleConsultAgent(socket, args);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('[Proxy] consult_agent failed:', error);
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
    }
  );

  // Register continue_conversation tool
  server.tool(
    'continue_conversation',
    'Continue a multi-turn consultation to dig deeper or ask follow-up questions',
    {
      conversationId: z
        .string()
        .uuid()
        .describe('The conversation ID from a previous consult_agent call'),
      message: z.string().describe('Your follow-up question or response'),
    },
    async (args) => {
      try {
        const socket = await daemonClient.getSocket();
        const result = await handleContinueConversation(socket, args);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('[Proxy] continue_conversation failed:', error);
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
    }
  );

  // Register end_conversation tool
  server.tool(
    'end_conversation',
    'End a consultation session and archive it',
    {
      conversationId: z
        .string()
        .uuid()
        .describe('The conversation ID to end and archive'),
    },
    async (args) => {
      try {
        const socket = await daemonClient.getSocket();
        const result = await handleEndConversation(socket, args);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error('[Proxy] end_conversation failed:', error);
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
    }
  );

  // Connect using stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[Proxy] MCP Proxy connected and ready');

  // Handle shutdown
  process.on('SIGINT', () => {
    console.error('[Proxy] Received SIGINT, shutting down');
    daemonClient.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.error('[Proxy] Received SIGTERM, shutting down');
    daemonClient.disconnect();
    process.exit(0);
  });
}

// Start the proxy
main().catch((error) => {
  console.error('[Proxy] Failed to start:', error);
  process.exit(1);
});
