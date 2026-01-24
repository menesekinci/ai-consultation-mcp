import type { Config } from '../types/index.js';

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Config = {
  defaultModel: 'deepseek-reasoner',
  maxMessages: 5,
  providers: {
    deepseek: {
      enabled: false,
    },
    openai: {
      enabled: false,
    },
  },
};

/**
 * Default system prompt for consultations
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant being consulted for a second opinion on a problem or task.
Provide thoughtful, well-reasoned responses that offer a fresh perspective.
Be concise but thorough in your analysis.`;

/**
 * Maximum allowed messages per conversation
 */
export const MAX_MESSAGES_LIMIT = 5;

/**
 * Conversation timeout in milliseconds (30 minutes)
 */
export const CONVERSATION_TIMEOUT_MS = 30 * 60 * 1000;
