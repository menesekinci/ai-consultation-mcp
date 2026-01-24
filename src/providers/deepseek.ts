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
 * DeepSeek API base URL
 */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * DeepSeek Provider - Uses OpenAI-compatible SDK
 */
export class DeepSeekProvider extends BaseProvider {
  readonly name: ProviderType = 'deepseek';
  private client: OpenAI | null = null;

  /**
   * Get or create the OpenAI-compatible client for DeepSeek
   */
  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        throw this.createError(
          'AUTH_ERROR',
          'DeepSeek API key not configured',
          false
        );
      }

      const config = getConfigManager().getConfig();
      this.client = new OpenAI({
        apiKey,
        baseURL: DEEPSEEK_BASE_URL,
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
   * Check if a model supports system prompts
   */
  private supportsSystemPrompt(model: string): boolean {
    const config = MODEL_CONFIG[model as ModelType];
    return config?.supportsSystemPrompt ?? true;
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
    const supportsSystem = this.supportsSystemPrompt(options.model);

    this.logRequest(apiModel, messages.length, options);

    const startTime = Date.now();

    try {
      // Build messages array
      let chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      // Handle system prompt
      if (options.systemPrompt) {
        if (supportsSystem) {
          chatMessages.push({
            role: 'system',
            content: options.systemPrompt,
          });
        } else {
          // For reasoning models, prepend to first user message
          messages = this.formatSystemPromptAsUser(messages, options.systemPrompt);
        }
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
      };

      // Handle token limits differently for reasoning models
      if (isReasoning) {
        // Reasoning models use max_completion_tokens
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (requestParams as any).max_completion_tokens =
          options.maxTokens || 4096;
        // DeepSeek reasoner: temperature must be 0
        requestParams.temperature = 0;
      } else {
        // Standard models use max_tokens
        requestParams.max_tokens = options.maxTokens || 4096;
        // Set temperature for non-reasoning models
        if (options.temperature !== undefined) {
          requestParams.temperature = options.temperature;
        }
      }

      const response = await client.chat.completions.create(requestParams);

      const choice = response.choices[0];
      const content = choice?.message?.content || '';

      // Extract reasoning content if present (DeepSeek Reasoner specific)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reasoningContent = (choice?.message as any)
        ?.reasoning_content as string | undefined;

      const responseTime = Date.now() - startTime;

      if (reasoningContent) {
        logger.debug('Reasoning content received', {
          model: apiModel,
          reasoningLength: reasoningContent.length,
          thinkingTime: responseTime,
        });
      }

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
        reasoningContent,
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
