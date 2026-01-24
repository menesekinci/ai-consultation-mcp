#!/usr/bin/env node

/**
 * Standalone Web UI Server
 *
 * This script runs as a completely separate process from the MCP server.
 * It's spawned by openWebUI() and handles:
 * 1. Starting the Express server
 * 2. Opening the browser automatically
 *
 * Usage: node dist/api/standalone-server.js [port]
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { getConfigManager } from '../config/index.js';
import { configRoutes } from './routes/config.js';
import { providerRoutes } from './routes/providers.js';
import chatRoutes from './routes/chat.js';
import { securityMiddleware } from './middleware/security.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3456;

async function main(): Promise<void> {
  // Parse port from command line args
  const port = parseInt(process.argv[2], 10) || DEFAULT_PORT;

  // Initialize config
  const configManager = getConfigManager();
  await configManager.init();

  const app = express();

  // Middleware
  app.use(express.json());
  app.use(securityMiddleware);

  // API routes
  app.use('/api/config', configRoutes);
  app.use('/api/providers', providerRoutes);
  app.use('/api/chat', chatRoutes);

  // Serve static UI files
  const uiPath = path.join(__dirname, '../ui');
  app.use(express.static(uiPath));

  // Fallback to index.html for SPA-like behavior
  app.use((_req, res, next) => {
    if (!_req.path.startsWith('/api') && !path.extname(_req.path)) {
      res.sendFile(path.join(uiPath, 'index.html'));
    } else {
      next();
    }
  });

  // Error handling middleware
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('HTTP server error:', err.message);
      res.status(500).json({
        error: 'Internal server error',
        message: err.message,
      });
    }
  );

  // Start server
  const server = app.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Web UI server started at ${url}`);

    // Open browser
    open(url, { wait: false }).catch((err) => {
      console.error('Failed to open browser:', err.message);
      console.log(`Please open ${url} in your browser manually`);
    });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Port already in use - server might already be running
      // Just try to open browser
      const url = `http://127.0.0.1:${port}`;
      console.log(`Port ${port} already in use, attempting to open browser...`);
      open(url, { wait: false }).catch(() => {
        console.log(`Please open ${url} in your browser manually`);
      });
      // Exit after attempting to open browser
      setTimeout(() => process.exit(0), 1000);
    } else {
      console.error('Server error:', err.message);
      process.exit(1);
    }
  });
}

main().catch((error) => {
  console.error('Failed to start standalone server:', error);
  process.exit(1);
});
