import type { ModelType, ProviderType } from '../types/index.js';

/**
 * Message format for provider communication
 */
export interface ProviderMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Options for creating a completion
 */
export interface CompletionOptions {
  model: ModelType;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Token usage information
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Response from a provider
 */
export interface ProviderResponse {
  content: string;
  model: string;
  usage?: TokenUsage;
  finishReason?: string;
  reasoningContent?: string;
  responseTime?: number; // Response time in milliseconds
}

/**
 * Provider error information
 */
export interface ProviderErrorInfo {
  provider: ProviderType;
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

/**
 * Provider interface - all providers must implement this
 */
export interface IProvider {
  readonly name: ProviderType;

  /**
   * Check if the provider is configured with valid credentials
   */
  isConfigured(): boolean;

  /**
   * Create a chat completion
   */
  createCompletion(
    messages: ProviderMessage[],
    options: CompletionOptions
  ): Promise<ProviderResponse>;
}

/**
 * Model configuration
 */
export interface ModelConfig {
  provider: ProviderType;
  apiModel: string;
  maxTokens: number;
  supportsSystemPrompt: boolean;
  isReasoning: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
}
