import type { Server, Socket } from 'socket.io';
import OpenAI from 'openai';
import { getConfig } from './config.js';
import { addMessage, getConversation, archiveConversation } from './conversation.js';
import type { ModelType } from '../../types/index.js';
import { withRetry } from '../../utils/index.js';
import { retrieveContext } from '../../rag/retrieval.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

interface ConsultRequest {
  conversationId: string;
  question: string;
  context?: string;
  model?: ModelType;
  docIds?: string[];
  docTitles?: string[];
}

interface ConsultResponse {
  conversationId: string;
  response: string;
  model: string;
  success: boolean;
  error?: string;
}

/**
 * Get provider client based on model
 */
export function getProviderClient(model: ModelType): OpenAI | null {
  const config = getConfig();

  // Determine which provider to use
  const isDeepSeek = model.startsWith('deepseek');

  if (isDeepSeek) {
    const provider = config.providers.deepseek;
    if (!provider.enabled || !provider.apiKey) {
      return null;
    }
    return new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl || DEEPSEEK_BASE_URL,
      timeout: config.requestTimeout,
    });
  } else {
    const provider = config.providers.openai;
    if (!provider.enabled || !provider.apiKey) {
      return null;
    }
    return new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl || OPENAI_BASE_URL,
      timeout: config.requestTimeout,
    });
  }
}

/**
 * Call AI provider
 */
async function callProvider(
  _conversationId: string,
  model: ModelType,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
): Promise<string> {
  const client = getProviderClient(model);

  if (!client) {
    throw new Error(`Provider not configured for model: ${model}`);
  }

  const response = await withRetry(() => client.chat.completions.create({
    model,
    messages: messages.map((m) => ({
      role: m.role as any,
      content: m.content,
    })),
  }), {
    onRetry: (_error, attempt, delay) => {
      console.log(`[Provider] Retrying ${model} call (attempt ${attempt}) after ${delay}ms...`);
    }
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from provider');
  }

  return content;
}

/**
 * Handle consult request
 */
async function handleConsult(
  io: Server,
  data: ConsultRequest
): Promise<ConsultResponse> {
  const config = getConfig();
  const model = data.model || config.defaultModel;

  try {
    // Get conversation
    const conv = getConversation(data.conversationId);
    if (!conv) {
      return {
        conversationId: data.conversationId,
        response: '',
        model,
        success: false,
        error: 'Conversation not found',
      };
    }

    // Build user message
    let userContent = data.question;
    if (data.context) {
      userContent = `${data.question}\n\nContext:\n${data.context}`;
    }

    // Add user message
    const userMsg = addMessage(data.conversationId, 'user', userContent);
    io.emit('conversation:message', { conversationId: data.conversationId, message: userMsg });

    // Prepare messages for API
    const apiMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

    if (conv.systemPrompt) {
      apiMessages.push({ role: 'system', content: conv.systemPrompt });
    }

    const rag = await retrieveContext(data.question, {
      docIds: data.docIds,
      docTitles: data.docTitles,
    });
    if (rag.context) {
      apiMessages.push({ role: 'system', content: rag.context });
    }

    // Add conversation history
    for (const msg of conv.messages) {
      apiMessages.push({ role: msg.role, content: msg.content });
    }

    // Add new user message
    apiMessages.push({ role: 'user', content: userContent });

    // Check message limit
    if (conv.messages.length >= config.maxMessages * 2) {
      archiveConversation(data.conversationId, 'timeout');
      io.emit('conversation:ended', { conversationId: data.conversationId, reason: 'timeout' });
      return {
        conversationId: data.conversationId,
        response: '',
        model,
        success: false,
        error: 'Message limit reached, conversation archived',
      };
    }

    // Call provider
    const response = await callProvider(data.conversationId, model, apiMessages);

    // Add assistant message
    const assistantMsg = addMessage(data.conversationId, 'assistant', response);
    io.emit('conversation:message', { conversationId: data.conversationId, message: assistantMsg });

    return {
      conversationId: data.conversationId,
      response,
      model,
      success: true,
    };
  } catch (error) {
    console.error('Error in consult:', error);
    return {
      conversationId: data.conversationId,
      response: '',
      model,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Register provider socket handlers
 */
export function registerProviderHandlers(io: Server, socket: Socket): void {
  // Consult AI
  socket.on('provider:consult', async (data: ConsultRequest, callback: (result: ConsultResponse) => void) => {
    const result = await handleConsult(io, data);
    callback(result);
  });

  // Test provider connection
  socket.on(
    'provider:test',
    async (model: ModelType, callback: (result: { success: boolean; error?: string }) => void) => {
      try {
        const client = getProviderClient(model);
        if (!client) {
          callback({ success: false, error: 'Provider not configured' });
          return;
        }

        // Simple test call
        await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Say "OK"' }],
          max_tokens: 5,
        });

        callback({ success: true });
      } catch (error) {
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}
