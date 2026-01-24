import type { Server, Socket } from 'socket.io';
import { getDatabase, configQueries } from '../database.js';
import type { Config } from '../../types/index.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';

/**
 * Get full config from database
 */
export function getConfig(): Config {
  const db = getDatabase();
  const rows = configQueries.getAll(db).all() as { key: string; value: string }[];

  const configMap = new Map(rows.map((r) => [r.key, r.value]));

  // Build config from stored values or defaults
  return {
    defaultModel: (configMap.get('defaultModel') as Config['defaultModel']) || DEFAULT_CONFIG.defaultModel,
    maxMessages: parseInt(configMap.get('maxMessages') || String(DEFAULT_CONFIG.maxMessages), 10),
    requestTimeout: parseInt(configMap.get('requestTimeout') || String(DEFAULT_CONFIG.requestTimeout), 10),
    autoOpenWebUI: configMap.has('autoOpenWebUI')
      ? configMap.get('autoOpenWebUI') === 'true'
      : DEFAULT_CONFIG.autoOpenWebUI,
    providers: configMap.has('providers')
      ? JSON.parse(configMap.get('providers')!)
      : DEFAULT_CONFIG.providers,
  };
}

/**
 * Update config values
 */
export function updateConfig(updates: Partial<Config>): void {
  const db = getDatabase();
  const setQuery = configQueries.set(db);

  if (updates.defaultModel !== undefined) {
    setQuery.run({ key: 'defaultModel', value: updates.defaultModel });
  }
  if (updates.maxMessages !== undefined) {
    setQuery.run({ key: 'maxMessages', value: String(updates.maxMessages) });
  }
  if (updates.requestTimeout !== undefined) {
    setQuery.run({ key: 'requestTimeout', value: String(updates.requestTimeout) });
  }
  if (updates.autoOpenWebUI !== undefined) {
    setQuery.run({ key: 'autoOpenWebUI', value: String(updates.autoOpenWebUI) });
  }
  if (updates.providers !== undefined) {
    setQuery.run({ key: 'providers', value: JSON.stringify(updates.providers) });
  }
}

/**
 * Get a single config value
 */
export function getConfigValue(key: string): string | null {
  const db = getDatabase();
  const row = configQueries.get(db).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Set a single config value
 */
export function setConfigValue(key: string, value: string): void {
  const db = getDatabase();
  configQueries.set(db).run({ key, value });
}

/**
 * Register config socket handlers
 */
export function registerConfigHandlers(io: Server, socket: Socket): void {
  // Get full config
  socket.on('config:get', (callback: (config: Config) => void) => {
    try {
      const config = getConfig();
      callback(config);
    } catch (error) {
      console.error('Error getting config:', error);
      callback(DEFAULT_CONFIG);
    }
  });

  // Update config
  socket.on('config:update', (updates: Partial<Config>, callback: (success: boolean) => void) => {
    try {
      updateConfig(updates);
      // Broadcast to all clients
      io.emit('config:updated', getConfig());
      callback(true);
    } catch (error) {
      console.error('Error updating config:', error);
      callback(false);
    }
  });

  // Get single value
  socket.on('config:getValue', (key: string, callback: (value: string | null) => void) => {
    try {
      callback(getConfigValue(key));
    } catch (error) {
      console.error('Error getting config value:', error);
      callback(null);
    }
  });

  // Set single value
  socket.on('config:setValue', (data: { key: string; value: string }, callback: (success: boolean) => void) => {
    try {
      setConfigValue(data.key, data.value);
      io.emit('config:updated', getConfig());
      callback(true);
    } catch (error) {
      console.error('Error setting config value:', error);
      callback(false);
    }
  });
}
