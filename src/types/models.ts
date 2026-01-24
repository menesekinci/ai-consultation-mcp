/**
 * Provider types
 */
export type ProviderType = 'deepseek' | 'openai';

/**
 * Supported AI model types
 */
export type ModelType =
  | 'deepseek-chat'
  | 'deepseek-reasoner'
  | 'gpt-5.2'
  | 'gpt-5.2-pro';

/**
 * List of all supported models (as const for Zod enum)
 */
export const MODEL_TYPES = [
  'deepseek-chat',
  'deepseek-reasoner',
  'gpt-5.2',
  'gpt-5.2-pro',
] as const;

/**
 * List of all supported models (array version)
 */
export const MODEL_LIST: ModelType[] = [...MODEL_TYPES];

/**
 * Mapping from model to provider
 */
export const MODEL_TO_PROVIDER: Record<ModelType, ProviderType> = {
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  'gpt-5.2': 'openai',
  'gpt-5.2-pro': 'openai',
};

/**
 * Model configuration interface
 */
export interface ModelConfig {
  provider: ProviderType;
  apiModel: string;
  maxTokens: number;
  supportsSystemPrompt: boolean;
  isReasoning: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/**
 * Model configuration mapping
 */
export const MODEL_CONFIG: Record<ModelType, ModelConfig> = {
  // DeepSeek V3 - Chat (fast, general purpose)
  'deepseek-chat': {
    provider: 'deepseek',
    apiModel: 'deepseek-chat',
    maxTokens: 8192,
    supportsSystemPrompt: true,
    isReasoning: false,
  },
  // DeepSeek R1 - Reasoner (deep thinking, specialized tasks)
  'deepseek-reasoner': {
    provider: 'deepseek',
    apiModel: 'deepseek-reasoner',
    maxTokens: 64000,
    supportsSystemPrompt: false,
    isReasoning: true,
  },
  // OpenAI GPT-5.2 - Flagship model (400K context)
  'gpt-5.2': {
    provider: 'openai',
    apiModel: 'gpt-5.2',
    maxTokens: 400000,
    supportsSystemPrompt: true,
    isReasoning: true,
    reasoningEffort: 'medium',
  },
  // OpenAI GPT-5.2 Pro - More compute, better answers
  'gpt-5.2-pro': {
    provider: 'openai',
    apiModel: 'gpt-5.2-pro',
    maxTokens: 400000,
    supportsSystemPrompt: true,
    isReasoning: true,
    reasoningEffort: 'high',
  },
};

/**
 * Default model for consultations
 */
export const DEFAULT_MODEL: ModelType = 'deepseek-reasoner';
