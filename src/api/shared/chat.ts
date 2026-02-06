import type { Message } from '../../types/index.js';

export interface ChatConversationLike {
  id: string;
  model: string;
  messages: Message[];
  createdAt: Date | string;
  lastActivityAt: Date | string;
}

export interface ArchivedConversationLike extends ChatConversationLike {
  endedAt?: Date | string | null;
  endReason?: string | null;
}

export interface ChatHistoryResponse {
  count: number;
  activeCount: number;
  archivedCount: number;
  active: Array<{
    id: string;
    model: string;
    messageCount: number;
    messages: Array<{ id: string; role: Message['role']; content: string }>;
    createdAt: string;
    lastActivityAt: string;
    status: 'active';
  }>;
  archived: Array<{
    id: string;
    model: string;
    messageCount: number;
    messages: Array<{ id: string; role: Message['role']; content: string }>;
    createdAt: string;
    lastActivityAt: string;
    endedAt: string | null;
    endReason: string | null;
    status: 'archived';
  }>;
  conversations: Array<
    | ChatHistoryResponse['active'][number]
    | ChatHistoryResponse['archived'][number]
  >;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildChatHistoryResponse(
  activeConversations: ChatConversationLike[],
  archivedConversations: ArchivedConversationLike[]
): ChatHistoryResponse {
  const active = activeConversations.map((conv) => ({
    id: conv.id,
    model: conv.model,
    messageCount: conv.messages.length,
    messages: conv.messages.map((msg, idx) => ({
      id: `${conv.id}-${idx}`,
      role: msg.role,
      content: msg.content,
    })),
    createdAt: toIsoString(conv.createdAt) ?? new Date(0).toISOString(),
    lastActivityAt: toIsoString(conv.lastActivityAt) ?? new Date(0).toISOString(),
    status: 'active' as const,
  }));

  const archived = archivedConversations.map((conv) => ({
    id: conv.id,
    model: conv.model,
    messageCount: conv.messages.length,
    messages: conv.messages.map((msg, idx) => ({
      id: `${conv.id}-${idx}`,
      role: msg.role,
      content: msg.content,
    })),
    createdAt: toIsoString(conv.createdAt) ?? new Date(0).toISOString(),
    lastActivityAt: toIsoString(conv.lastActivityAt) ?? new Date(0).toISOString(),
    endedAt: toIsoString(conv.endedAt) ?? null,
    endReason: conv.endReason ?? null,
    status: 'archived' as const,
  }));

  const conversations = [...active, ...archived];

  return {
    count: conversations.length,
    activeCount: active.length,
    archivedCount: archived.length,
    active,
    archived,
    conversations,
  };
}
