import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ragRoutes } from '../api/routes/rag.js';
import { consultRoutes } from '../api/routes/consult.js';
import { checkEmbedServiceHealth, getEmbedUrl } from '../rag/embeddings.js';
import {
  registerConfigHandlers,
  registerConversationHandlers,
  registerProviderHandlers,
  getActiveConversations,
  getArchivedConversations,
  deleteConversation,
  getConfig,
  updateConfig,
  getProviderClient,
} from './handlers/index.js';
import { getDatabase, conversationQueries, type DbConversation } from './database.js';
import { toPublicConfig, parseConfigPatch } from '../api/shared/config.js';
import {
  isProviderType,
  getModelsForProvider,
  getProviderDetails,
  listProviderDetails,
  maskKey,
} from '../api/shared/providers.js';
import { buildChatHistoryResponse } from '../api/shared/chat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ConnectedClient {
  id: string;
  type: 'proxy' | 'webui' | 'unknown';
  connectedAt: Date;
}

const connectedClients = new Map<string, ConnectedClient>();

/**
 * Create and configure the daemon server
 */
export function createDaemonServer(port: number, authToken?: string): {
  io: Server;
  httpServer: ReturnType<typeof createServer>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const app = express();
  const httpServer = createServer(app);

  // Socket.io server
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // Socket.io authentication middleware
  if (authToken) {
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (token === authToken) {
        return next();
      }
      console.log(`[Daemon] Authentication failed for socket: ${socket.id}`);
      return next(new Error('Authentication failed'));
    });
  }

  // Middleware
  app.use(express.json());

  // REST API authentication middleware
  if (authToken) {
    app.use('/api', (req, res, next) => {
      const token = req.headers['x-daemon-token'] || req.query.token;
      if (token === authToken) {
        return next();
      }
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid daemon token' });
    });
  }

  // Serve static UI files
  const uiPath = path.join(__dirname, '..', 'ui');
  app.use(express.static(uiPath));

  // REST API endpoints for backward compatibility
  app.get('/api/health', async (_req, res) => {
    const embedHealth = await checkEmbedServiceHealth();
    res.json({
      status: 'ok',
      clients: connectedClients.size,
      uptime: process.uptime(),
      embedService: { available: embedHealth.available, url: getEmbedUrl(), error: embedHealth.error },
    });
  });

  app.use('/api/rag', ragRoutes);
  app.use('/api/consult', consultRoutes);

  app.get('/api/config', (_req, res) => {
    try {
      res.json(toPublicConfig(getConfig()));
    } catch (error) {
      res.status(500).json({ error: 'Failed to get config' });
    }
  });

  app.patch('/api/config', (req, res) => {
    try {
      const parsed = parseConfigPatch(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid configuration update', message: parsed.error });
        return;
      }

      updateConfig(parsed.data);
      io.emit('config:updated', getConfig());
      res.json({ success: true, updated: parsed.data });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  app.get('/api/chat/history', (_req, res) => {
    try {
      const active = getActiveConversations();
      const archived = getArchivedConversations();
      res.json(
        buildChatHistoryResponse(
          active.map((conv) => ({
            id: conv.id,
            model: conv.model,
            messages: conv.messages,
            createdAt: conv.createdAt,
            lastActivityAt: conv.updatedAt,
          })),
          archived.map((conv) => ({
            id: conv.id,
            model: conv.model,
            messages: conv.messages,
            createdAt: conv.createdAt,
            lastActivityAt: conv.updatedAt,
            endedAt: conv.endedAt,
            endReason: conv.endReason,
          }))
        )
      );
    } catch (error) {
      res.status(500).json({ error: 'Failed to get history' });
    }
  });

  app.delete('/api/chat/:id', (req, res) => {
    try {
      const id = String(req.params.id);
      const success = deleteConversation(id);
      if (!success) {
        res.status(404).json({ error: 'Conversation not found or already removed' });
        return;
      }
      io.emit('conversation:deleted', { conversationId: id });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete conversation' });
    }
  });

  app.delete('/api/chat/archived/all', (_req, res) => {
    try {
      const archived = getArchivedConversations();
      let deleted = 0;
      for (const conv of archived) {
        if (deleteConversation(conv.id)) {
          deleted += 1;
          io.emit('conversation:deleted', { conversationId: conv.id });
        }
      }
      res.json({ success: true, deleted });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete archived conversations' });
    }
  });

  // Providers endpoints
  app.get('/api/providers', (_req, res) => {
    try {
      res.json(listProviderDetails(getConfig()));
    } catch (error) {
      res.status(500).json({ error: 'Failed to list providers' });
    }
  });

  app.get('/api/providers/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!isProviderType(id)) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }
      res.json(getProviderDetails(getConfig(), id));
    } catch (error) {
      res.status(500).json({ error: 'Failed to get provider' });
    }
  });

  app.put('/api/providers/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { apiKey } = req.body;
      if (!isProviderType(id)) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        res.status(400).json({ error: 'Invalid API key' });
        return;
      }
      const config = getConfig();
      const updatedProviders = {
        ...config.providers,
        [id]: { ...config.providers[id], apiKey: apiKey.trim(), enabled: true },
      };
      updateConfig({ providers: updatedProviders });
      io.emit('config:updated', getConfig());
      res.json({ success: true, provider: id, maskedKey: maskKey(apiKey.trim()) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to set API key' });
    }
  });

  app.delete('/api/providers/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!isProviderType(id)) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }
      const config = getConfig();
      const updatedProviders = {
        ...config.providers,
        [id]: { enabled: false },
      };
      updateConfig({ providers: updatedProviders });
      io.emit('config:updated', getConfig());
      res.json({ success: true, provider: id });
    } catch (error) {
      res.status(500).json({ error: 'Failed to remove API key' });
    }
  });

  // Test provider API key
  app.post('/api/providers/:id/test', async (req, res) => {
    try {
      const { id } = req.params;
      if (!isProviderType(id)) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }

      const config = getConfig();
      const providerConfig = config.providers[id];

      if (!providerConfig?.apiKey) {
        res.status(400).json({ error: 'No API key configured for this provider' });
        return;
      }

      // Test the API key by making a simple request
      const testModel = getModelsForProvider(id)[0];
      if (!testModel) {
        res.status(400).json({ error: 'No models available for this provider' });
        return;
      }

      const client = getProviderClient(testModel);
      if (!client) {
        res.status(400).json({ error: 'Provider not configured' });
        return;
      }

      // Simple test call
      const response = await client.chat.completions.create({
        model: testModel,
        messages: [{ role: 'user', content: 'Say "OK"' }],
        max_tokens: 5,
      });

      const content = response.choices[0]?.message?.content;
      res.json({ success: true, message: 'API key is valid', response: content });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Test failed' });
    }
  });

  // 404 handler - serve SPA for non-API routes
  app.use((req, res) => {
    // For API routes that don't exist, return 404 JSON
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not found', path: req.path });
      return;
    }
    // For other routes, serve SPA
    res.sendFile(path.join(uiPath, 'index.html'));
  });

  // Socket.io connection handling
  io.on('connection', (socket) => {
    const clientType = (socket.handshake.query.type as string) || 'unknown';

    const client: ConnectedClient = {
      id: socket.id,
      type: clientType as ConnectedClient['type'],
      connectedAt: new Date(),
    };

    connectedClients.set(socket.id, client);
    console.log(`[Daemon] Client connected: ${socket.id} (${clientType})`);

    // Broadcast client count
    io.emit('clients:count', connectedClients.size);

    // Register handlers
    registerConfigHandlers(io, socket);
    registerConversationHandlers(io, socket);
    registerProviderHandlers(io, socket);

    // Ping/pong for keepalive
    socket.on('ping', (callback) => {
      if (typeof callback === 'function') {
        callback('pong');
      }
    });

    // Disconnect handling
    socket.on('disconnect', (reason) => {
      connectedClients.delete(socket.id);
      console.log(`[Daemon] Client disconnected: ${socket.id} (${reason})`);
      io.emit('clients:count', connectedClients.size);
    });
  });

  // Auto-archive stale conversations
  const STALE_TIMEOUT_MINUTES = 5; // Archive after 5 minutes of inactivity
  const CLEANUP_INTERVAL_MS = 1 * 60 * 1000; // Check every 1 minute

  const cleanupInterval = setInterval(() => {
    try {
      const db = getDatabase();

      // First get the stale conversations to notify clients
      const staleConversations = conversationQueries.getStaleActive(db).all(STALE_TIMEOUT_MINUTES) as DbConversation[];

      if (staleConversations.length > 0) {
        // Archive them
        const result = conversationQueries.archiveStale(db).run(STALE_TIMEOUT_MINUTES);

        if (result.changes > 0) {
          console.log(`[Daemon] Auto-archived ${result.changes} stale conversation(s)`);

          // Notify all clients about each archived conversation
          for (const conv of staleConversations) {
            io.emit('conversation:ended', { conversationId: conv.id, reason: 'timeout' });
          }
        }
      }
    } catch (error) {
      console.error('[Daemon] Auto-archive error:', error);
    }
  }, CLEANUP_INTERVAL_MS);

  // Run once on startup to clean up any stale conversations from before
  setTimeout(() => {
    try {
      const db = getDatabase();
      const result = conversationQueries.archiveStale(db).run(STALE_TIMEOUT_MINUTES);
      if (result.changes > 0) {
        console.log(`[Daemon] Startup cleanup: archived ${result.changes} stale conversation(s)`);
      }
    } catch (error) {
      console.error('[Daemon] Startup cleanup error:', error);
    }
  }, 1000);

  return {
    io,
    httpServer,
    start: () => {
      return new Promise((resolve, reject) => {
        httpServer.listen(port, '127.0.0.1', () => {
          console.log(`[Daemon] Server listening on http://127.0.0.1:${port}`);
          resolve();
        });
        httpServer.on('error', reject);
      });
    },
    stop: () => {
      return new Promise((resolve) => {
        clearInterval(cleanupInterval);
        io.close(() => {
          httpServer.close(() => {
            resolve();
          });
        });
      });
    },
  };
}

export { connectedClients };
