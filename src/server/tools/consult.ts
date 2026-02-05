import { z } from 'zod';
import { conversationManager } from '../conversation.js';
import { getConfigManager, getSystemPromptForMode } from '../../config/index.js';
import {
  consultRequestSchema,
  continueRequestSchema,
  endRequestSchema,
  type ConsultationMode,
} from '../../config/schema.js';
import { logger, ProviderNotConfiguredError } from '../../utils/index.js';
import type {
  ConsultResponse,
  ContinueResponse,
  EndResponse,
  ResponseMetadata,
  ModelType,
} from '../../types/index.js';
import { MODEL_TO_PROVIDER } from '../../types/index.js';
import {
  getProviderRegistry,
  type ProviderMessage,
  type ProviderResponse,
} from '../../providers/index.js';
import { retrieveContext } from '../../rag/retrieval.js';

/**
 * Summarize reasoning content for display
 * Extracts key points if the reasoning is too long
 */
function summarizeReasoning(reasoning: string | undefined, maxLength = 500): string | undefined {
  if (!reasoning) return undefined;

  // If short enough, return as-is
  if (reasoning.length <= maxLength) return reasoning;

  // Try to extract key sentences/points
  const lines = reasoning.split('\n').filter(line => line.trim());
  const summary: string[] = [];
  let totalLength = 0;

  for (const line of lines) {
    if (totalLength + line.length > maxLength - 50) break;
    summary.push(line);
    totalLength += line.length;
  }

  if (summary.length > 0) {
    return summary.join('\n') + '\n... [truncated, ' + reasoning.length + ' chars total]';
  }

  return reasoning.substring(0, maxLength) + '... [truncated]';
}

/**
 * Get provider response for a conversation
 */
async function getProviderResponse(
  messages: ProviderMessage[],
  model: string,
  systemPrompt: string
): Promise<ProviderResponse> {
  const registry = getProviderRegistry();
  const providerType = MODEL_TO_PROVIDER[model as ModelType];
  const provider = registry.getProvider(providerType);

  if (!provider.isConfigured()) {
    throw new ProviderNotConfiguredError(providerType);
  }

  const response = await provider.createCompletion(messages, {
    model: model as ModelType,
    systemPrompt,
    maxTokens: 4096,
  });

  return response;
}

/**
 * Convert conversation messages to provider format
 */
function toProviderMessages(conversationId: string): ProviderMessage[] {
  const conversation = conversationManager.get(conversationId);
  return conversation.messages.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));
}

/**
 * Consult an AI agent for a second opinion
 */
export async function consultAgent(
  input: z.infer<typeof consultRequestSchema>
): Promise<ConsultResponse> {
  const validated = consultRequestSchema.parse(input);
  const config = getConfigManager().getConfig();

  // Determine which model to use (default from config)
  const model = config.defaultModel;
  const mode = validated.mode || 'general';

  // Check if the provider for this model is configured
  const providerType = MODEL_TO_PROVIDER[model];
  if (!getConfigManager().isProviderConfigured(providerType)) {
    throw new ProviderNotConfiguredError(providerType);
  }

  logger.info('Starting consultation', { model, mode });

  // Get system prompt for the mode
  const systemPrompt = getSystemPromptForMode(mode as ConsultationMode);
  const rag = await retrieveContext(validated.question, {
    docIds: validated.docIds,
    docTitles: validated.docTitles,
  });
  const finalSystemPrompt = rag.context ? `${systemPrompt}\n\n${rag.context}` : systemPrompt;

  // Create conversation
  const conversation = conversationManager.create(model, systemPrompt);

  // Build the user message with optional context
  let userMessage = validated.question;
  if (validated.context) {
    userMessage = `Context:\n${validated.context}\n\nQuestion:\n${validated.question}`;
  }

  // Add user message
  conversationManager.addMessage(conversation.id, 'user', userMessage);

  // Get AI response
  const messages = toProviderMessages(conversation.id);
  const response = await getProviderResponse(messages, model, finalSystemPrompt);

  // Add assistant response
  conversationManager.addMessage(conversation.id, 'assistant', response.content);

  // Build metadata with thinking information
  const responseTime = response.responseTime || 0;
  const metadata: ResponseMetadata = {
    responseTime,
    tokensUsed: response.usage?.totalTokens,
    thinking: response.reasoningContent
      ? {
          summary: summarizeReasoning(response.reasoningContent) || '',
          fullLength: response.reasoningContent.length,
          durationMs: responseTime,
        }
      : undefined,
  };

  logger.info('Consultation completed', {
    conversationId: conversation.id,
    model,
    mode,
    messageCount: conversationManager.getMessageCount(conversation.id),
    responseTime: metadata.responseTime,
  });

  return {
    answer: response.content,
    conversationId: conversation.id,
    model,
    mode,
    messageCount: conversationManager.getMessageCount(conversation.id),
    canContinue: conversationManager.canContinue(conversation.id),
    metadata,
  };
}

/**
 * Continue an existing conversation
 */
export async function continueConversation(
  input: z.infer<typeof continueRequestSchema>
): Promise<ContinueResponse> {
  const validated = continueRequestSchema.parse(input);

  // Get existing conversation
  const conversation = conversationManager.get(validated.conversationId);

  logger.info('Continuing conversation', {
    conversationId: validated.conversationId,
    model: conversation.model,
  });

  // Add user message
  conversationManager.addMessage(
    validated.conversationId,
    'user',
    validated.message
  );

  // Get AI response
  const messages = toProviderMessages(validated.conversationId);
  const rag = await retrieveContext(validated.message, {
    docIds: validated.docIds,
    docTitles: validated.docTitles,
  });
  const systemPrompt = rag.context
    ? `${conversation.systemPrompt || ''}\n\n${rag.context}`.trim()
    : (conversation.systemPrompt || '');
  const response = await getProviderResponse(
    messages,
    conversation.model,
    systemPrompt
  );

  // Add assistant response
  conversationManager.addMessage(
    validated.conversationId,
    'assistant',
    response.content
  );

  logger.info('Conversation continued', {
    conversationId: validated.conversationId,
    messageCount: conversationManager.getMessageCount(validated.conversationId),
  });

  return {
    answer: response.content,
    conversationId: validated.conversationId,
    messageCount: conversationManager.getMessageCount(validated.conversationId),
    canContinue: conversationManager.canContinue(validated.conversationId),
  };
}

/**
 * End a conversation
 */
export async function endConversation(
  input: z.infer<typeof endRequestSchema>
): Promise<EndResponse> {
  const validated = endRequestSchema.parse(input);

  logger.info('Ending conversation', {
    conversationId: validated.conversationId,
  });

  const totalMessages = conversationManager.end(validated.conversationId);

  return {
    status: 'ended',
    conversationId: validated.conversationId,
    totalMessages,
  };
}
