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
  SUPPORTED_TOOLS,
} from './installer/index.js';
import { createDaemonClient } from './proxy/daemon-client.js';
import { registerProxyTools } from './mcp/tools/proxy.js';
import { registerLegacyTools } from './mcp/tools/legacy.js';

function parseArgs(): {
  mode: 'mcp' | 'config' | 'install' | 'uninstall' | 'daemon' | 'legacy';
  port?: number;
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

  if (args.includes('--config') || args.includes('config') || args.includes('-c')) {
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

  if (args.includes('--help') || args.includes('-h')) {
    const toolNames = SUPPORTED_TOOLS.map((t) => t.name).join(', ');
    console.log(`
AI Consultation MCP - Get second opinions from DeepSeek and OpenAI models

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
  const { mode, port } = parseArgs();

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

  if (mode === 'config') {
    try {
      await startConfigUI({ port, openBrowser: true });
    } catch (error) {
      console.error('Failed to start config UI:', error instanceof Error ? error.message : error);
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
