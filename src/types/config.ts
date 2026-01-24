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
  requestTimeout: number; // API request timeout in milliseconds
  autoOpenWebUI: boolean; // Auto-open Web UI when agent uses tools
  providers: {
    deepseek: ProviderConfig;
    openai: ProviderConfig;
  };
}
