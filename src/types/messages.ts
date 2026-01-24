/**
 * Chat message structure
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Response metadata for enhanced tracking
 */
export interface ResponseMetadata {
  responseTime: number; // Response time in milliseconds
  tokensUsed?: number;
  thinking?: {
    summary: string; // Summarized/truncated thinking for display
    fullLength: number; // Total characters of full thinking content
    durationMs: number; // How long the thinking took
  };
}

/**
 * Response from consult_agent tool
 */
export interface ConsultResponse {
  answer: string;
  conversationId: string;
  model: string;
  mode: string;
  messageCount: number;
  canContinue: boolean;
  metadata?: ResponseMetadata;
}

/**
 * Response from continue_conversation tool
 */
export interface ContinueResponse {
  answer: string;
  conversationId: string;
  messageCount: number;
  canContinue: boolean;
}

/**
 * Response from end_conversation tool
 */
export interface EndResponse {
  status: 'ended';
  conversationId: string;
  totalMessages: number;
}
