#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getConfigManager } from './config/index.js';
import { logger } from './utils/index.js';
import { initializeProviders } from './providers/index.js';
import { startConfigUI } from './api/index.js';
import {
  installToAllTools,
  printInstallSummary,
  uninstallFromAllTools,
  printUninstallSummary,
} from './installer/index.js';
import { createDaemonClient } from './proxy/daemon-client.js';
import { registerProxyTools } from './mcp/tools/proxy.js';
import { registerLegacyTools } from './mcp/tools/legacy.js';

function parseArgs(): {
  mode: 'mcp' | 'init' | 'install' | 'uninstall' | 'daemon' | 'legacy';
} {
  const args = process.argv.slice(2);

  if (args.includes('--uninstall') || args.includes('uninstall') || args.includes('-u')) {
    return { mode: 'uninstall' };
  }

  if (args.includes('--install') || args.includes('install') || args.includes('-i')) {
    return { mode: 'install' };
  }

  if (args.includes('--daemon') || args.includes('daemon') || args.includes('-d')) {
    return { mode: 'daemon' };
  }

  if (args.includes('--legacy') || args.includes('--standalone')) {
    return { mode: 'legacy' };
  }

  if (args.includes('--init') || args.includes('init')) {
    return { mode: 'init' };
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
AI Consultation MCP - Get second opinions from DeepSeek and OpenAI models

Usage:
  ai-consultation-mcp           Start MCP proxy (connects to central daemon)
  ai-consultation-mcp --install Auto-detect & install to all AI tools
  ai-consultation-mcp --init    Initialize config (loads env variables)
  ai-consultation-mcp --daemon  Start the central daemon directly
  ai-consultation-mcp --help    Show this help message

Options:
  --install, -i    Auto-detect installed AI tools and add MCP to each
  --init          Load config from environment variables
  --daemon, -d    Start central daemon (auto-started by proxy if needed)
  --legacy        Use legacy standalone mode (no daemon)
  --help, -h      Show this help message

Environment Variables:
  DEEPSEEK_API_KEY   Your DeepSeek API key
  OPENAI_API_KEY     Your OpenAI API key

Quick Start:
  1. export DEEPSEEK_API_KEY=your_key
  2. ai-consultation-mcp --install
  3. Restart your AI tools

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

async function startProxyMode(): Promise<void> {
  console.error('[MCP] Starting AI Consultation MCP Proxy...');

  const daemonClient = createDaemonClient();
  const server = new McpServer({
    name: 'ai-consultation',
    version: '2.1.0',
  });

  registerProxyTools(server, daemonClient);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] Proxy connected and ready');
}

async function startLegacyMode(): Promise<void> {
  const configManager = getConfigManager();
  await configManager.init();
  await initializeProviders();

  logger.info('Starting Agent Consultation MCP Server (Legacy Mode)');

  const server = new McpServer({
    name: 'agent-consultation',
    version: '2.1.0',
  });

  registerLegacyTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP Server connected and ready (Legacy Mode)');
}

async function main(): Promise<void> {
  const { mode } = parseArgs();

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
        console.log('\n💡 To configure API keys, set environment variables:');
        console.log('   export DEEPSEEK_API_KEY=your_key');
        console.log('   export OPENAI_API_KEY=your_key\n');
        process.exit(0);
      }
    } else {
      console.log('\n💡 No supported AI tools found.');
      console.log('   Install one of the supported tools and run this installer again.\n');
      process.exit(0);
    }
    return;
  }

  if (mode === 'uninstall') {
    console.log('🧹 AI Consultation MCP - Uninstaller\n');
    console.log('Scanning for installed AI tools...\n');

    const summary = uninstallFromAllTools();
    printUninstallSummary(summary);
    process.exit(0);
  }

  if (mode === 'daemon') {
    const { initDatabase } = await import('./daemon/database.js');
    const { createDaemonServer } = await import('./daemon/server.js');
    const { acquireLock, removeLockFile, isDaemonRunning, runMigration } = await import(
      './daemon/utils/index.js'
    );

    const existingPort = isDaemonRunning();
    if (existingPort) {
      console.log(`Daemon already running on port ${existingPort}`);
      process.exit(0);
    }

    const daemonPort = 3456;
    const lock = acquireLock(daemonPort);
    if (!lock) {
      console.error('Failed to acquire lock');
      process.exit(1);
    }

    try {
      initDatabase();
      runMigration();
      const server = createDaemonServer(daemonPort, lock.token);
      await server.start();
      console.log(`Daemon started on http://127.0.0.1:${daemonPort}`);
    } catch (error) {
      console.error('Failed to start daemon:', error);
      removeLockFile();
      process.exit(1);
    }
    return;
  }

  if (mode === 'init') {
    try {
      await startConfigUI({ openBrowser: false });
      console.log('\n✅ Configuration loaded from environment variables');
    } catch (error) {
      console.error('Failed to initialize config:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
    return;
  }

  if (mode === 'legacy') {
    console.warn(
      '[Deprecated] --legacy mode will be removed in a future release. Use the default daemon/proxy mode.'
    );
    await startLegacyMode();
    return;
  }

  await startProxyMode();
}

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down');
  process.exit(0);
});

main().catch((error) => {
  logger.error('Failed to start MCP server', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exit(1);
});
