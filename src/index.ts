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
} from './server/index.js';
import { initializeProviders } from './providers/index.js';
import { startConfigUI, openWebUI } from './api/index.js';
import { installToAllTools, printInstallSummary, SUPPORTED_TOOLS } from './installer/index.js';

/**
 * Parse CLI arguments
 */
function parseArgs(): { mode: 'mcp' | 'config' | 'install'; port?: number } {
  const args = process.argv.slice(2);

  // Check for install mode
  if (args.includes('--install') || args.includes('install') || args.includes('-i')) {
    return { mode: 'install' };
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
Agent Consultation MCP - Get second opinions from DeepSeek Reasoner

Usage:
  npx agent-consultation-mcp           Start MCP server (stdio transport)
  npx agent-consultation-mcp --install Auto-detect & install to all AI tools
  npx agent-consultation-mcp --config  Open configuration UI in browser
  npx agent-consultation-mcp --help    Show this help message

Options:
  --install, -i        Auto-detect installed AI tools and add MCP to each
  --config, -c         Open configuration UI to manage API keys
  --port <number>, -p  Set port for config UI (default: 3456)
  --help, -h           Show this help message

Supported AI Tools:
  ${toolNames}

Quick Start:
  1. npx agent-consultation-mcp --install  (auto-detects all tools)
  2. Restart your AI tools to load the MCP
  3. npx agent-consultation-mcp --config   (configure API key)
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
`);
    process.exit(0);
  }

  return { mode: 'mcp' };
}

/**
 * Initialize and start the MCP server
 */
async function main(): Promise<void> {
  const { mode, port } = parseArgs();

  // Install mode - auto-detect and install to all tools
  if (mode === 'install') {
    console.log('🔧 Agent Consultation MCP - Multi-Tool Installer\n');
    console.log('Scanning for installed AI tools...\n');

    const summary = installToAllTools();
    printInstallSummary(summary);

    // If any tools were installed, offer to open config UI
    if (summary.installed.length > 0 || summary.skipped.length > 0) {
      console.log('Opening configuration UI...\n');
      try {
        await startConfigUI({ openBrowser: true });
      } catch {
        console.log('💡 Run "npx agent-consultation-mcp --config" to configure API keys.\n');
        process.exit(0);
      }
    } else {
      process.exit(0);
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

  // MCP server mode (default)
  // Initialize configuration
  const configManager = getConfigManager();
  await configManager.init();

  // Initialize providers
  await initializeProviders();

  logger.info('Starting Agent Consultation MCP Server');

  // Create MCP server
  const server = new McpServer({
    name: 'agent-consultation',
    version: '2.0.0',
  });

  // Register consult_agent tool
  server.tool(
    'consult_agent',
    'Get a second opinion from another AI model to enrich your perspective. Use this when you want critical feedback, alternative approaches, or to challenge your assumptions. The consulted model will act as a critical reviewer, not a yes-man.',
    {
      question: z.string().describe('The problem, approach, or decision you want a second opinion on'),
      mode: z
        .enum(CONSULTATION_MODES)
        .optional()
        .describe('Consultation focus: debug (error analysis), analyzeCode (code review), reviewArchitecture (design decisions), validatePlan (plan critique), explainConcept (learning), or general (open discussion)'),
      context: z
        .string()
        .optional()
        .describe('Supporting context: code snippets, error messages, your current approach, or relevant background'),
    },
    async (args) => {
      // Open Web UI in browser when tool is triggered
      openWebUI().catch(() => {});

      try {
        const result = await consultAgent(args);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('consult_agent failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
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
    'Continue a multi-turn consultation to dig deeper, ask follow-up questions, or explore alternative perspectives further',
    {
      conversationId: z
        .string()
        .uuid()
        .describe('The conversation ID from a previous consult_agent call'),
      message: z.string().describe('Your follow-up question, clarification request, or response to their feedback'),
    },
    async (args) => {
      // Open Web UI in browser when tool is triggered
      openWebUI().catch(() => {});

      try {
        const result = await continueConversation(args);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('continue_conversation failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
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
    'End a consultation session and archive it for future reference',
    {
      conversationId: z
        .string()
        .uuid()
        .describe('The conversation ID to end and archive'),
    },
    async (args) => {
      // Open Web UI in browser when tool is triggered
      openWebUI().catch(() => {});

      try {
        const result = await endConversation(args);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('end_conversation failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
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

  logger.info('MCP Server connected and ready');
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
