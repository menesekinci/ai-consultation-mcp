#!/usr/bin/env node

import { initDatabase, closeDatabase } from './database.js';
import { createDaemonServer, connectedClients } from './server.js';
import { acquireLock, removeLockFile, isDaemonRunning, runMigration } from './utils/index.js';
import { ensurePortAvailable } from '../utils/portKiller.js';

const DEFAULT_PORT = 3456;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let idleTimer: NodeJS.Timeout | null = null;
let server: ReturnType<typeof createDaemonServer> | null = null;

/**
 * Reset idle timer
 */
function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  // Only start idle timer if no clients connected
  if (connectedClients.size === 0) {
    idleTimer = setTimeout(() => {
      console.log('[Daemon] Idle timeout reached, shutting down...');
      shutdown();
    }, IDLE_TIMEOUT_MS);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  console.log('[Daemon] Shutting down...');

  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (server) {
    await server.stop();
    server = null;
  }

  closeDatabase();
  removeLockFile();

  console.log('[Daemon] Shutdown complete');
  process.exit(0);
}

/**
 * Find an available port, trying to free the default port first
 */
async function findAvailablePort(startPort: number, isDefault = true): Promise<number> {
  // Check if port is available
  if (isDefault) {
    const portCheck = await ensurePortAvailable(startPort, { autoKill: false, silent: false });
    if (portCheck.available) {
      return startPort;
    }
    // If not available, try next port
    console.log(`   Port ${startPort} is busy. Trying alternative port ${startPort + 1}...`);
    return findAvailablePort(startPort + 1, false);
  }

  // For non-default ports, just check if available
  const net = await import('net');

  return new Promise((resolve, reject) => {
    const testServer = net.createServer();

    testServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port in use, try next
        resolve(findAvailablePort(startPort + 1, false));
      } else {
        reject(err);
      }
    });

    testServer.listen(startPort, '127.0.0.1', () => {
      testServer.close(() => {
        resolve(startPort);
      });
    });
  });
}

/**
 * Main daemon entry point
 */
async function main(): Promise<void> {
  // Check if daemon is already running
  const existingPort = isDaemonRunning();
  if (existingPort) {
    console.log(`[Daemon] Already running on port ${existingPort}`);
    process.exit(0);
  }

  // Find available port
  const port = await findAvailablePort(DEFAULT_PORT);

  // Acquire lock
  const lock = acquireLock(port);
  if (!lock) {
    console.error('[Daemon] Failed to acquire lock');
    process.exit(1);
  }

  console.log('[Daemon] Starting AI Consultation MCP Daemon...');

  // Initialize database
  try {
    initDatabase();
    console.log('[Daemon] Database initialized');

    // Run migration from JSON if needed
    runMigration();
  } catch (error) {
    console.error('[Daemon] Failed to initialize database:', error);
    removeLockFile();
    process.exit(1);
  }

  // Create and start server
  try {
    server = createDaemonServer(port, lock.token);
    await server.start();
  } catch (error) {
    console.error('[Daemon] Failed to start server:', error);
    closeDatabase();
    removeLockFile();
    process.exit(1);
  }

  // Set up client tracking for idle timeout
  server.io.on('connection', () => {
    resetIdleTimer();
  });

  server.io.on('disconnect', () => {
    resetIdleTimer();
  });

  // Start idle timer
  resetIdleTimer();

  console.log('[Daemon] Ready and waiting for connections');
}

// Handle signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Daemon] Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  console.error('[Daemon] Unhandled rejection:', reason);
  shutdown();
});

// Start daemon
main().catch((error) => {
  console.error('[Daemon] Failed to start:', error);
  process.exit(1);
});
