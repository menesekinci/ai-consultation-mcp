import type { Config } from '../types/index.js';

/**
 * Configuration constants
 */
export const CONVERSATION_LIMITS = {
  DEFAULT_MAX_MESSAGES: 5,
  MAX_ALLOWED_MESSAGES: 50,
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Config = {
  defaultModel: 'deepseek-reasoner',
  maxMessages: CONVERSATION_LIMITS.DEFAULT_MAX_MESSAGES,
  requestTimeout: 180000, // 3 minutes default
  autoOpenWebUI: false, // Auto-open Web UI when agent uses tools
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
 * Maximum allowed messages per conversation (used by legacy conversation manager)
 */
export const MAX_MESSAGES_LIMIT = CONVERSATION_LIMITS.DEFAULT_MAX_MESSAGES;

/**
 * Conversation timeout in milliseconds (30 minutes)
 */
export const CONVERSATION_TIMEOUT_MS = 30 * 60 * 1000;
