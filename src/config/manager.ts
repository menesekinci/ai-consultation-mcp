import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigError } from '../utils/index.js';
import { logger } from '../utils/index.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { encrypt, decrypt, isEncrypted } from './encryption.js';
import { configSchema } from './schema.js';
import type { Config } from '../types/index.js';

/**
 * Get the config directory path (in user's home directory)
 */
function getConfigDir(): string {
  return path.join(os.homedir(), '.agent-consultation-mcp');
}

/**
 * Get the config file path
 */
function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!fsSync.existsSync(configDir)) {
    fsSync.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Configuration file manager
 * Handles loading, saving, and encrypting configuration
 */
export class ConfigManager {
  private config: Config;
  private configPath: string;

  constructor(configPath?: string) {
    this.config = { ...DEFAULT_CONFIG };
    // Always use home directory for config (consistent across all invocations)
    this.configPath = configPath || getConfigPath();
    ensureConfigDir();
  }

  /**
   * Initialize the config manager and load configuration
   */
  async init(): Promise<void> {
    try {
      await this.load();
      logger.info('Configuration loaded successfully');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No config file found, using defaults');
        await this.save();
      } else {
        throw error;
      }
    }
  }

  /**
   * Load configuration from file
   */
  async load(): Promise<Config> {
    const data = await fs.readFile(this.configPath, 'utf-8');
    const rawConfig = JSON.parse(data);

    // Decrypt API keys
    const decryptedConfig = this.decryptApiKeys(rawConfig);

    // Validate configuration
    const result = configSchema.safeParse(decryptedConfig);
    if (!result.success) {
      throw new ConfigError(
        `Invalid configuration: ${result.error.message}`
      );
    }

    this.config = result.data;
    return this.config;
  }

  /**
   * Save configuration to file
   */
  async save(): Promise<void> {
    // Ensure config directory exists
    const configDir = path.dirname(this.configPath);
    await fs.mkdir(configDir, { recursive: true });

    // Encrypt API keys before saving
    const encryptedConfig = this.encryptApiKeys(this.config);

    await fs.writeFile(
      this.configPath,
      JSON.stringify(encryptedConfig, null, 2),
      'utf-8'
    );
    logger.info('Configuration saved');
  }

  /**
   * Get current configuration (with decrypted keys)
   */
  getConfig(): Config {
    return { ...this.config };
  }

  /**
   * Get configuration without API keys (safe for display)
   */
  getSafeConfig(): Config {
    const safe = { ...this.config };
    for (const provider of Object.keys(safe.providers) as Array<
      keyof typeof safe.providers
    >) {
      if (safe.providers[provider].apiKey) {
        safe.providers[provider] = {
          ...safe.providers[provider],
          apiKey: '***configured***',
        };
      }
    }
    return safe;
  }

  /**
   * Update configuration
   */
  async update(updates: Partial<Config>): Promise<void> {
    this.config = {
      ...this.config,
      ...updates,
      providers: {
        ...this.config.providers,
        ...updates.providers,
      },
    };

    // Validate after update
    const result = configSchema.safeParse(this.config);
    if (!result.success) {
      throw new ConfigError(
        `Invalid configuration update: ${result.error.message}`
      );
    }

    await this.save();
  }

  /**
   * Set provider API key
   */
  async setProviderKey(
    provider: keyof Config['providers'],
    apiKey: string
  ): Promise<void> {
    this.config.providers[provider] = {
      ...this.config.providers[provider],
      enabled: true,
      apiKey,
    };
    await this.save();
    logger.info(`API key set for provider: ${provider}`);
  }

  /**
   * Remove provider API key
   */
  async removeProviderKey(provider: keyof Config['providers']): Promise<void> {
    this.config.providers[provider] = {
      enabled: false,
      apiKey: undefined,
    };
    await this.save();
    logger.info(`API key removed for provider: ${provider}`);
  }

  /**
   * Check if a provider is configured
   */
  isProviderConfigured(provider: keyof Config['providers']): boolean {
    const providerConfig = this.config.providers[provider];
    return providerConfig.enabled && !!providerConfig.apiKey;
  }

  /**
   * Get API key for a provider (decrypted)
   */
  getProviderKey(provider: keyof Config['providers']): string | undefined {
    return this.config.providers[provider].apiKey;
  }

  /**
   * Encrypt API keys in config object
   */
  private encryptApiKeys(config: Config): Config {
    const encrypted = { ...config, providers: { ...config.providers } };

    for (const provider of Object.keys(encrypted.providers) as Array<
      keyof typeof encrypted.providers
    >) {
      const providerConfig = encrypted.providers[provider];
      if (providerConfig.apiKey && !isEncrypted(providerConfig.apiKey)) {
        encrypted.providers[provider] = {
          ...providerConfig,
          apiKey: encrypt(providerConfig.apiKey),
        };
      }
    }

    return encrypted;
  }

  /**
   * Decrypt API keys in config object
   */
  private decryptApiKeys(config: Config): Config {
    const decrypted = { ...config, providers: { ...config.providers } };

    for (const provider of Object.keys(decrypted.providers) as Array<
      keyof typeof decrypted.providers
    >) {
      const providerConfig = decrypted.providers[provider];
      if (providerConfig.apiKey && isEncrypted(providerConfig.apiKey)) {
        decrypted.providers[provider] = {
          ...providerConfig,
          apiKey: decrypt(providerConfig.apiKey),
        };
      }
    }

    return decrypted;
  }
}

// Singleton instance
let configManagerInstance: ConfigManager | null = null;

/**
 * Get the config manager instance
 */
export function getConfigManager(configPath?: string): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager(configPath);
  }
  return configManagerInstance;
}
