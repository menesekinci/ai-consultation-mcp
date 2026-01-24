import type { ProviderType } from '../types/index.js';
import type {
  IProvider,
  ProviderMessage,
  CompletionOptions,
  ProviderResponse,
  ProviderErrorInfo,
} from './types.js';
import { getConfigManager } from '../config/index.js';
import { logger } from '../utils/index.js';

/**
 * Custom error class for provider errors
 */
export class ProviderError extends Error {
  readonly info: ProviderErrorInfo;

  constructor(info: ProviderErrorInfo) {
    super(info.message);
    this.name = 'ProviderError';
    this.info = info;
  }
}

/**
 * Abstract base class for all providers
 */
export abstract class BaseProvider implements IProvider {
  abstract readonly name: ProviderType;

  /**
   * Get the API key for this provider
   */
  protected getApiKey(): string | undefined {
    return getConfigManager().getProviderKey(this.name);
  }

  /**
   * Check if the provider is configured
   */
  isConfigured(): boolean {
    return getConfigManager().isProviderConfigured(this.name);
  }

  /**
   * Create a chat completion - must be implemented by subclasses
   */
  abstract createCompletion(
    messages: ProviderMessage[],
    options: CompletionOptions
  ): Promise<ProviderResponse>;

  /**
   * Format system prompt for models that don't support it directly
   * Prepends system prompt to the first user message
   */
  protected formatSystemPromptAsUser(
    messages: ProviderMessage[],
    systemPrompt?: string
  ): ProviderMessage[] {
    if (!systemPrompt) return messages;

    const result = [...messages];
    const firstUserIndex = result.findIndex((m) => m.role === 'user');

    if (firstUserIndex >= 0) {
      result[firstUserIndex] = {
        ...result[firstUserIndex],
        content: `[System Instructions]\n${systemPrompt}\n\n[User Query]\n${result[firstUserIndex].content}`,
      };
    }

    return result;
  }

  /**
   * Log completion request
   */
  protected logRequest(
    model: string,
    messageCount: number,
    options: CompletionOptions
  ): void {
    logger.info('Provider completion request', {
      provider: this.name,
      model,
      messageCount,
      maxTokens: options.maxTokens,
      hasSystemPrompt: !!options.systemPrompt,
    });
  }

  /**
   * Log completion response
   */
  protected logResponse(response: ProviderResponse): void {
    logger.info('Provider completion response', {
      provider: this.name,
      model: response.model,
      finishReason: response.finishReason,
      usage: response.usage,
      hasReasoningContent: !!response.reasoningContent,
    });
  }

  /**
   * Create a standardized provider error
   */
  protected createError(
    code: string,
    message: string,
    retryable: boolean,
    statusCode?: number
  ): ProviderError {
    return new ProviderError({
      provider: this.name,
      code,
      message,
      retryable,
      statusCode,
    });
  }
}
