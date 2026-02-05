import type { Socket } from 'socket.io-client';
import type { ModelType } from '../types/index.js';

export interface ConsultArgs {
  question: string;
  mode?: string;
  context?: string;
  docIds?: string[];
  docTitles?: string[];
}

export interface ContinueArgs {
  conversationId: string;
  message: string;
  docIds?: string[];
  docTitles?: string[];
}

export interface EndArgs {
  conversationId: string;
}

export interface ConsultResult {
  conversationId: string;
  response: string;
  model: string;
  remainingMessages: number;
}

export interface ContinueResult {
  conversationId: string;
  response: string;
  remainingMessages: number;
}

export interface EndResult {
  success: boolean;
  message: string;
}

/**
 * Get system prompt based on consultation mode
 */
function getSystemPrompt(mode?: string): string {
  const prompts: Record<string, string> = {
    debug: `You are a debugging expert helping an AI coding agent troubleshoot issues.
Focus on:
- Systematic error analysis
- Root cause identification
- Step-by-step debugging strategies
- Clear explanations of what went wrong`,

    analyzeCode: `You are a code review expert helping an AI coding agent improve code quality.
Focus on:
- Bug detection
- Security vulnerabilities
- Performance issues
- Best practices and patterns`,

    reviewArchitecture: `You are a software architect helping an AI coding agent make design decisions.
Focus on:
- System design patterns
- Trade-offs analysis
- Scalability considerations
- Maintainability`,

    validatePlan: `You are a technical reviewer helping an AI coding agent validate implementation plans.
Focus on:
- Feasibility assessment
- Edge cases and risks
- Missing steps or considerations
- Alternative approaches`,

    explainConcept: `You are a patient teacher helping an AI coding agent understand concepts.
Focus on:
- Clear explanations with examples
- Analogies and mental models
- Progressive complexity
- Practical applications`,

    general: `You are a helpful AI assistant providing a second opinion to an AI coding agent.
Provide thoughtful, well-reasoned responses that offer fresh perspectives.
Be concise but thorough. Challenge assumptions when appropriate.`,
  };

  return prompts[mode || 'general'] || prompts.general;
}

/**
 * Handle consult_agent tool call via daemon
 */
export async function handleConsultAgent(
  socket: Socket,
  args: ConsultArgs
): Promise<ConsultResult> {
  // Get config for model and max messages
  const config = await new Promise<{
    defaultModel: ModelType;
    maxMessages: number;
  }>((resolve) => {
    socket.emit('config:get', resolve);
  });

  const systemPrompt = getSystemPrompt(args.mode);

  // Create conversation
  const conversation = await new Promise<{
    id: string;
    model: string;
  }>((resolve) => {
    socket.emit(
      'conversation:create',
      { model: config.defaultModel, systemPrompt },
      resolve
    );
  });

  // Consult AI
  const result = await new Promise<{
    conversationId: string;
    response: string;
    model: string;
    success: boolean;
    error?: string;
  }>((resolve) => {
    socket.emit(
      'provider:consult',
      {
        conversationId: conversation.id,
        question: args.question,
        context: args.context,
        docIds: args.docIds,
        docTitles: args.docTitles,
        model: config.defaultModel,
      },
      resolve
    );
  });

  if (!result.success) {
    throw new Error(result.error || 'Consultation failed');
  }

  return {
    conversationId: result.conversationId,
    response: result.response,
    model: result.model,
    remainingMessages: config.maxMessages - 1,
  };
}

/**
 * Handle continue_conversation tool call via daemon
 */
export async function handleContinueConversation(
  socket: Socket,
  args: ContinueArgs
): Promise<ContinueResult> {
  // Get config for max messages
  const config = await new Promise<{ maxMessages: number }>((resolve) => {
    socket.emit('config:get', resolve);
  });

  // Get conversation to check message count
  const conversation = await new Promise<{
    id: string;
    model: string;
    messages: Array<{ role: string }>;
  } | null>((resolve) => {
    socket.emit('conversation:get', args.conversationId, resolve);
  });

  if (!conversation) {
    throw new Error('Conversation not found');
  }

  // Consult AI
  const result = await new Promise<{
    conversationId: string;
    response: string;
    model: string;
    success: boolean;
    error?: string;
  }>((resolve) => {
    socket.emit(
      'provider:consult',
      {
        conversationId: args.conversationId,
        question: args.message,
        docIds: args.docIds,
        docTitles: args.docTitles,
        model: conversation.model,
      },
      resolve
    );
  });

  if (!result.success) {
    throw new Error(result.error || 'Continue failed');
  }

  const messageCount = Math.ceil(conversation.messages.length / 2) + 1;
  return {
    conversationId: result.conversationId,
    response: result.response,
    remainingMessages: Math.max(0, config.maxMessages - messageCount),
  };
}

/**
 * Handle end_conversation tool call via daemon
 */
export async function handleEndConversation(
  socket: Socket,
  args: EndArgs
): Promise<EndResult> {
  const success = await new Promise<boolean>((resolve) => {
    socket.emit(
      'conversation:archive',
      { id: args.conversationId, endReason: 'completed' },
      resolve
    );
  });

  return {
    success,
    message: success
      ? 'Conversation archived successfully'
      : 'Failed to archive conversation',
  };
}
