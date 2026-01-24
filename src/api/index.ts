import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import open from 'open';
import { getConfigManager } from '../config/index.js';
import { logger } from '../utils/index.js';
import { ensurePortAvailable } from '../utils/portKiller.js';
import { configRoutes } from './routes/config.js';
import { providerRoutes } from './routes/providers.js';
import chatRoutes from './routes/chat.js';
import { securityMiddleware } from './middleware/security.js';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3456;

// Track background UI server state
let backgroundServerRunning = false;
let browserOpened = false;
let backgroundServerPort = DEFAULT_PORT;

export interface ConfigUIOptions {
  port?: number;
  openBrowser?: boolean;
}

/**
 * Start the configuration UI HTTP server
 */
export async function startConfigUI(options: ConfigUIOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_PORT;
  const shouldOpenBrowser = options.openBrowser ?? true;

  // Check if port is available, try to free it if not
  const portCheck = await ensurePortAvailable(port, { autoKill: true, silent: false });
  if (!portCheck.available) {
    throw new Error(`Port ${port} is in use and could not be freed. Try a different port with --port ${port + 1}`);
  }

  // Ensure config is loaded
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

  // Fallback to index.html for SPA-like behavior (Express 5 compatible)
  app.use((_req, res, next) => {
    // Only serve index.html for non-API requests that don't have a file extension
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
      logger.error('HTTP server error', { error: err.message });
      res.status(500).json({
        error: 'Internal server error',
        message: err.message,
      });
    }
  );

  // CRITICAL: Bind to localhost only for security
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}`;
      logger.info(`Config UI running at ${url}`);
      console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   Agent Consultation MCP - Configuration UI    │
│                                                 │
│   URL: ${url.padEnd(40)}│
│                                                 │
│   Press Ctrl+C to stop                          │
│                                                 │
└─────────────────────────────────────────────────┘
`);

      // Open browser
      if (shouldOpenBrowser) {
        open(url)
          .then(() => {
            console.log(`   ✅ Browser opened successfully\n`);
          })
          .catch((err) => {
            logger.warn('Failed to open browser', { error: err.message });
            console.log(`   ⚠️  Could not open browser automatically\n`);
            console.log(`   💡 Please open the URL manually in your browser`);
            console.log(`   💡 Or run: npx ai-consultation-mcp --config\n`);
          });
      }

      resolve();
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // This should rarely happen now since we check port availability first
        logger.error(`Port ${port} is already in use`);
        console.error(`\n❌ Error: Port ${port} is still in use.`);
        console.error(`   Try a different port: npx ai-consultation-mcp --config --port ${port + 1}\n`);
      }
      reject(err);
    });
  });
}

/**
 * Start the UI server in background mode (for MCP mode)
 * Does not block and does not open browser automatically
 */
export async function startBackgroundUIServer(port: number = DEFAULT_PORT): Promise<boolean> {
  if (backgroundServerRunning) {
    return true;
  }

  // Ensure config is loaded
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
      logger.error('Background HTTP server error', { error: err.message });
      res.status(500).json({
        error: 'Internal server error',
        message: err.message,
      });
    }
  );

  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      backgroundServerRunning = true;
      backgroundServerPort = port;
      logger.info(`Background UI server started at http://127.0.0.1:${port}`);
      resolve(true);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, maybe server is already running from another process
        logger.debug(`Port ${port} already in use, assuming UI server is running`);
        backgroundServerRunning = true;
        backgroundServerPort = port;
        resolve(true);
      } else {
        logger.error('Failed to start background UI server', { error: err.message });
        resolve(false);
      }
    });
  });
}

/**
 * Open the Web UI in browser (only opens once per session)
 * Spawns a completely separate standalone server process that handles
 * both server startup and browser opening.
 */
export async function openWebUI(): Promise<void> {
  logger.info('openWebUI called', { browserOpened });

  if (browserOpened) {
    logger.info('Browser already opened, skipping');
    return;
  }

  // Path to the standalone server script
  const standaloneServerPath = path.join(__dirname, 'standalone-server.js');

  logger.info('Spawning standalone server process', { standaloneServerPath });

  try {
    // Spawn a completely detached process
    // This process will start the server AND open the browser
    const child = spawn(process.execPath, [standaloneServerPath, String(backgroundServerPort)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env }
    });

    // Unref to allow parent (MCP) process to exit independently
    child.unref();

    browserOpened = true;
    backgroundServerRunning = true;
    logger.info('Standalone server process spawned successfully');
  } catch (err) {
    logger.error('Failed to spawn standalone server process', {
      error: err instanceof Error ? err.message : 'Unknown error'
    });

    // Fallback: try to open browser directly (server might already be running)
    const url = `http://127.0.0.1:${backgroundServerPort}`;
    try {
      await open(url, { wait: false });
      browserOpened = true;
      logger.info('Browser opened via fallback');
    } catch (openErr) {
      logger.error('Fallback browser open also failed', {
        error: openErr instanceof Error ? openErr.message : 'Unknown error'
      });
    }
  }
}

/**
 * Check if browser has been opened
 */
export function isBrowserOpened(): boolean {
  return browserOpened;
}

/**
 * Check if background server is running
 */
export function isBackgroundServerRunning(): boolean {
  return backgroundServerRunning;
}
