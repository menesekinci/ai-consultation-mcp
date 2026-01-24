import type { ModelType } from './models.js';

/**
 * Configuration for a single AI provider
 */
export interface ProviderConfig {
  apiKey?: string;
  enabled: boolean;
  baseUrl?: string;
}

/**
 * Main application configuration
 */
export interface Config {
  defaultModel: ModelType;
  maxMessages: number;
  providers: {
    deepseek: ProviderConfig;
    openai: ProviderConfig;
  };
}
