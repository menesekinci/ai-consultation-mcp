/**
 * Base error class for MCP errors
 */
export class MCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

/**
 * Error thrown by AI providers
 */
export class ProviderError extends MCPError {
  constructor(
    provider: string,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(`[${provider}] ${message}`, 'PROVIDER_ERROR', {
      provider,
      ...details,
    });
    this.name = 'ProviderError';
  }
}

/**
 * Error in conversation management
 */
export class ConversationError extends MCPError {
  constructor(message: string, conversationId?: string) {
    super(message, 'CONVERSATION_ERROR', { conversationId });
    this.name = 'ConversationError';
  }
}

/**
 * Error in configuration
 */
export class ConfigError extends MCPError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

/**
 * Error when provider is not configured
 */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(provider: string) {
    super(
      provider,
      `Provider ${provider} is not configured. Please add API key in settings.`
    );
    this.name = 'ProviderNotConfiguredError';
  }
}
