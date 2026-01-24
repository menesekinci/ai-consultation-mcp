import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  registerConfigHandlers,
  registerConversationHandlers,
  registerProviderHandlers,
  getActiveConversations,
  getArchivedConversations,
  getConfig,
  updateConfig,
  getProviderClient,
} from './handlers/index.js';
import { getDatabase, conversationQueries, type DbConversation } from './database.js';
import { MODEL_TO_PROVIDER, MODEL_CONFIG, MODEL_TYPES } from '../types/index.js';
import type { ProviderType, ModelType } from '../types/index.js';

// Provider display information
const PROVIDER_INFO: Record<ProviderType, { name: string; description: string }> = {
  deepseek: { name: 'DeepSeek', description: 'DeepSeek Chat and Reasoner models' },
  openai: { name: 'ChatGPT', description: 'GPT-5.2 and GPT-5.2 Pro models' },
};

function getModelsForProvider(providerId: ProviderType): ModelType[] {
  return Object.entries(MODEL_TO_PROVIDER)
    .filter(([_, provider]) => provider === providerId)
    .map(([model]) => model as ModelType);
}

function maskKey(key: string): string {
  if (key.length <= 4) return '••••••••';
  return '••••••••' + key.slice(-4);
}

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
export function createDaemonServer(port: number): {
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

  // Middleware
  app.use(express.json());

  // Serve static UI files
  const uiPath = path.join(__dirname, '..', 'ui');
  app.use(express.static(uiPath));

  // REST API endpoints for backward compatibility
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      clients: connectedClients.size,
      uptime: process.uptime(),
    });
  });

  app.get('/api/config', (_req, res) => {
    try {
      const config = getConfig();
      res.json({
        defaultModel: config.defaultModel,
        maxMessages: config.maxMessages,
        requestTimeout: config.requestTimeout,
        availableModels: MODEL_TYPES,
        providers: Object.fromEntries(
          Object.entries(config.providers).map(([id, cfg]) => [
            id,
            { enabled: cfg.enabled, hasKey: !!cfg.apiKey },
          ])
        ),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get config' });
    }
  });

  app.patch('/api/config', (req, res) => {
    try {
      const { defaultModel, maxMessages, requestTimeout } = req.body;
      const updates: { defaultModel?: ModelType; maxMessages?: number; requestTimeout?: number } = {};

      if (defaultModel !== undefined) {
        if (!MODEL_TYPES.includes(defaultModel)) {
          res.status(400).json({ error: 'Invalid model' });
          return;
        }
        updates.defaultModel = defaultModel;
      }
      if (maxMessages !== undefined) {
        const num = parseInt(maxMessages, 10);
        if (isNaN(num) || num < 1 || num > 50) {
          res.status(400).json({ error: 'Invalid maxMessages' });
          return;
        }
        updates.maxMessages = num;
      }
      if (requestTimeout !== undefined) {
        const num = parseInt(requestTimeout, 10);
        if (isNaN(num) || num < 30000 || num > 600000) {
          res.status(400).json({ error: 'Invalid requestTimeout' });
          return;
        }
        updates.requestTimeout = num;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: 'No updates provided' });
        return;
      }

      updateConfig(updates);
      io.emit('config:updated', getConfig());
      res.json({ success: true, updated: updates });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  app.get('/api/chat/history', (_req, res) => {
    try {
      const active = getActiveConversations();
      const archived = getArchivedConversations();

      res.json({
        activeCount: active.length,
        archivedCount: archived.length,
        active,
        archived,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get history' });
    }
  });

  // Providers endpoints
  app.get('/api/providers', (_req, res) => {
    try {
      const config = getConfig();
      const providers = (Object.keys(PROVIDER_INFO) as ProviderType[]).map((id) => {
        const providerConfig = config.providers[id];
        const models = getModelsForProvider(id);
        return {
          id,
          name: PROVIDER_INFO[id].name,
          description: PROVIDER_INFO[id].description,
          enabled: providerConfig?.enabled ?? false,
          hasKey: !!providerConfig?.apiKey,
          maskedKey: providerConfig?.apiKey ? maskKey(providerConfig.apiKey) : null,
          models: models.map((m) => ({
            id: m,
            name: m,
            isReasoning: MODEL_CONFIG[m]?.isReasoning ?? false,
          })),
        };
      });
      res.json(providers);
    } catch (error) {
      res.status(500).json({ error: 'Failed to list providers' });
    }
  });

  app.get('/api/providers/:id', (req, res) => {
    try {
      const { id } = req.params;
      if (!PROVIDER_INFO[id as ProviderType]) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }
      const config = getConfig();
      const providerConfig = config.providers[id as ProviderType];
      const models = getModelsForProvider(id as ProviderType);
      res.json({
        id,
        name: PROVIDER_INFO[id as ProviderType].name,
        description: PROVIDER_INFO[id as ProviderType].description,
        enabled: providerConfig?.enabled ?? false,
        hasKey: !!providerConfig?.apiKey,
        maskedKey: providerConfig?.apiKey ? maskKey(providerConfig.apiKey) : null,
        models: models.map((m) => ({
          id: m,
          name: m,
          isReasoning: MODEL_CONFIG[m]?.isReasoning ?? false,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get provider' });
    }
  });

  app.put('/api/providers/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { apiKey } = req.body;
      if (!PROVIDER_INFO[id as ProviderType]) {
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
        [id]: { ...config.providers[id as ProviderType], apiKey: apiKey.trim(), enabled: true },
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
      if (!PROVIDER_INFO[id as ProviderType]) {
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
      if (!PROVIDER_INFO[id as ProviderType]) {
        res.status(404).json({ error: 'Provider not found' });
        return;
      }

      const config = getConfig();
      const providerConfig = config.providers[id as ProviderType];

      if (!providerConfig?.apiKey) {
        res.status(400).json({ error: 'No API key configured for this provider' });
        return;
      }

      // Test the API key by making a simple request
      const testModel = getModelsForProvider(id as ProviderType)[0];
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
