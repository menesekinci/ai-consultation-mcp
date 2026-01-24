import type { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
  getDatabase,
  conversationQueries,
  messageQueries,
  type DbConversation,
  type DbMessage,
} from '../database.js';

// Public conversation interface
export interface Conversation {
  id: string;
  model: string;
  systemPrompt: string | null;
  status: 'active' | 'archived';
  endReason: 'completed' | 'timeout' | 'manual' | null;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  messages: Message[];
}

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

/**
 * Convert DB conversation to public format
 */
function toConversation(dbConv: DbConversation, messages: DbMessage[] = []): Conversation {
  return {
    id: dbConv.id,
    model: dbConv.model,
    systemPrompt: dbConv.system_prompt,
    status: dbConv.status,
    endReason: dbConv.end_reason,
    createdAt: dbConv.created_at,
    updatedAt: dbConv.updated_at,
    endedAt: dbConv.ended_at,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    })),
  };
}

/**
 * Create a new conversation
 */
export function createConversation(model: string, systemPrompt?: string): Conversation {
  const db = getDatabase();
  const id = uuidv4();

  conversationQueries.create(db).run({
    id,
    model,
    systemPrompt: systemPrompt ?? null,
  });

  const conv = conversationQueries.getById(db).get(id) as DbConversation;
  return toConversation(conv);
}

/**
 * Get conversation by ID with messages
 */
export function getConversation(id: string): Conversation | null {
  const db = getDatabase();
  const conv = conversationQueries.getById(db).get(id) as DbConversation | undefined;

  if (!conv) {
    return null;
  }

  const messages = messageQueries.getByConversation(db).all(id) as DbMessage[];
  return toConversation(conv, messages);
}

/**
 * Get all active conversations
 */
export function getActiveConversations(): Conversation[] {
  const db = getDatabase();
  const convs = conversationQueries.getActive(db).all() as DbConversation[];

  return convs.map((conv) => {
    const messages = messageQueries.getByConversation(db).all(conv.id) as DbMessage[];
    return toConversation(conv, messages);
  });
}

/**
 * Get all archived conversations
 */
export function getArchivedConversations(): Conversation[] {
  const db = getDatabase();
  const convs = conversationQueries.getArchived(db).all() as DbConversation[];

  return convs.map((conv) => {
    const messages = messageQueries.getByConversation(db).all(conv.id) as DbMessage[];
    return toConversation(conv, messages);
  });
}

/**
 * Add a message to conversation
 */
export function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Message {
  const db = getDatabase();

  // Add message
  const result = messageQueries.create(db).run({
    conversationId,
    role,
    content,
  });

  // Touch conversation
  conversationQueries.touch(db).run(conversationId);

  return {
    id: Number(result.lastInsertRowid),
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Archive a conversation
 */
export function archiveConversation(
  id: string,
  endReason: 'completed' | 'timeout' | 'manual' = 'manual'
): boolean {
  const db = getDatabase();
  const result = conversationQueries.archive(db).run({ id, endReason });
  return result.changes > 0;
}

/**
 * Delete a conversation
 */
export function deleteConversation(id: string): boolean {
  const db = getDatabase();
  const result = conversationQueries.deleteConversation(db).run(id);
  return result.changes > 0;
}

/**
 * Register conversation socket handlers
 */
export function registerConversationHandlers(io: Server, socket: Socket): void {
  // Create conversation
  socket.on(
    'conversation:create',
    (data: { model: string; systemPrompt?: string }, callback: (conv: Conversation) => void) => {
      try {
        const conv = createConversation(data.model, data.systemPrompt);
        io.emit('conversation:created', conv);
        callback(conv);
      } catch (error) {
        console.error('Error creating conversation:', error);
        callback(null as unknown as Conversation);
      }
    }
  );

  // Get conversation
  socket.on('conversation:get', (id: string, callback: (conv: Conversation | null) => void) => {
    try {
      callback(getConversation(id));
    } catch (error) {
      console.error('Error getting conversation:', error);
      callback(null);
    }
  });

  // List active
  socket.on('conversation:listActive', (callback: (convs: Conversation[]) => void) => {
    try {
      callback(getActiveConversations());
    } catch (error) {
      console.error('Error listing active conversations:', error);
      callback([]);
    }
  });

  // List archived
  socket.on('conversation:listArchived', (callback: (convs: Conversation[]) => void) => {
    try {
      callback(getArchivedConversations());
    } catch (error) {
      console.error('Error listing archived conversations:', error);
      callback([]);
    }
  });

  // Add message
  socket.on(
    'conversation:addMessage',
    (
      data: { conversationId: string; role: 'user' | 'assistant' | 'system'; content: string },
      callback: (message: Message | null) => void
    ) => {
      try {
        const message = addMessage(data.conversationId, data.role, data.content);
        io.emit('conversation:message', { conversationId: data.conversationId, message });
        callback(message);
      } catch (error) {
        console.error('Error adding message:', error);
        callback(null);
      }
    }
  );

  // Archive conversation
  socket.on(
    'conversation:archive',
    (
      data: { id: string; endReason?: 'completed' | 'timeout' | 'manual' },
      callback: (success: boolean) => void
    ) => {
      try {
        const success = archiveConversation(data.id, data.endReason);
        if (success) {
          io.emit('conversation:ended', { conversationId: data.id, reason: data.endReason || 'manual' });
        }
        callback(success);
      } catch (error) {
        console.error('Error archiving conversation:', error);
        callback(false);
      }
    }
  );

  // Delete conversation
  socket.on('conversation:delete', (id: string, callback: (success: boolean) => void) => {
    try {
      const success = deleteConversation(id);
      if (success) {
        io.emit('conversation:deleted', { conversationId: id });
      }
      callback(success);
    } catch (error) {
      console.error('Error deleting conversation:', error);
      callback(false);
    }
  });
}
