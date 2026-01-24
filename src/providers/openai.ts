import OpenAI from 'openai';
import type { ProviderType, ModelType } from '../types/index.js';
import { MODEL_CONFIG } from '../types/index.js';
import type {
  ProviderMessage,
  CompletionOptions,
  ProviderResponse,
} from './types.js';
import { BaseProvider } from './base.js';
import { getConfigManager } from '../config/index.js';
import { logger } from '../utils/index.js';

/**
 * OpenAI Provider - GPT-5.2 models
 */
export class OpenAIProvider extends BaseProvider {
  readonly name: ProviderType = 'openai';
  private client: OpenAI | null = null;

  /**
   * Get or create the OpenAI client
   */
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        throw this.createError(
          'AUTH_ERROR',
          'OpenAI API key not configured',
          false
        );
      }

      const config = getConfigManager().getConfig();
      this.client = new OpenAI({
        apiKey,
        timeout: config.requestTimeout,
      });
    }
    return this.client;
  }

  /**
   * Check if a model is a reasoning model
   */
  private isReasoningModel(model: string): boolean {
    const config = MODEL_CONFIG[model as ModelType];
    return config?.isReasoning ?? false;
  }

  /**
   * Get reasoning effort for the model
   */
  private getReasoningEffort(model: string): string | undefined {
    const config = MODEL_CONFIG[model as ModelType];
    return config?.reasoningEffort;
  }

  /**
   * Get the actual API model ID
   */
  private getApiModel(model: string): string {
    const config = MODEL_CONFIG[model as ModelType];
    return config?.apiModel ?? model;
  }

  /**
   * Create a chat completion
   */
  async createCompletion(
    messages: ProviderMessage[],
    options: CompletionOptions
  ): Promise<ProviderResponse> {
    const client = this.getClient();
    const apiModel = this.getApiModel(options.model);
    const isReasoning = this.isReasoningModel(options.model);
    const reasoningEffort = this.getReasoningEffort(options.model);

    this.logRequest(apiModel, messages.length, options);

    const startTime = Date.now();

    try {
      // Build messages array
      const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      // Add system prompt if provided
      if (options.systemPrompt) {
        chatMessages.push({
          role: 'system',
          content: options.systemPrompt,
        });
      }

      // Add conversation messages
      chatMessages.push(
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      );

      // Build request parameters
      const requestParams: OpenAI.Chat.ChatCompletionCreateParams = {
        model: apiModel,
        messages: chatMessages,
        max_tokens: options.maxTokens || 4096,
      };

      // Add reasoning effort for GPT-5.2 models
      if (isReasoning && reasoningEffort) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (requestParams as any).reasoning_effort = reasoningEffort;
      }

      // Set temperature for non-reasoning or if specified
      if (options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }

      const response = await client.chat.completions.create(requestParams);

      const choice = response.choices[0];
      const content = choice?.message?.content || '';

      const responseTime = Date.now() - startTime;

      logger.debug('OpenAI response received', {
        model: apiModel,
        responseTime,
        finishReason: choice?.finish_reason,
      });

      const result: ProviderResponse = {
        content,
        model: response.model,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        finishReason: choice?.finish_reason || undefined,
        responseTime,
      };

      this.logResponse(result);
      return result;
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        const retryable =
          error.status === 429 ||
          error.status === 500 ||
          error.status === 503;

        throw this.createError(
          error.code || 'API_ERROR',
          error.message,
          retryable,
          error.status
        );
      }
      throw error;
    }
  }
}
