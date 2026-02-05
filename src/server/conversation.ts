import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConversationError, FileLock } from '../utils/index.js';
import { MAX_MESSAGES_LIMIT, CONVERSATION_TIMEOUT_MS } from '../config/index.js';
import type { Message, ModelType } from '../types/index.js';

// Config directory in user's home (consistent across all invocations)
const CONFIG_DIR = path.join(os.homedir(), '.ai-consultation-mcp');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Conversations file paths (in home directory)
const CONVERSATIONS_FILE = path.join(CONFIG_DIR, 'conversations.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'conversation_history.json');

/**
 * Serializable conversation for file storage
 */
interface SerializedConversation {
  id: string;
  model: ModelType;
  messages: Message[];
  systemPrompt: string;
  createdAt: string;
  lastActivityAt: string;
}

/**
 * Archived conversation with end reason
 */
export interface ArchivedConversation extends SerializedConversation {
  endedAt: string;
  endReason: 'completed' | 'timeout' | 'manual' | 'session_restart';
}

/**
 * Represents an active conversation
 */
export interface Conversation {
  id: string;
  model: ModelType;
  messages: Message[];
  systemPrompt: string;
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Manages active conversations with file persistence
 *
 * Note: Multiple MCP instances may run concurrently (different agents).
 * Each instance only tracks its own conversations in memory.
 * File storage is append-only for history - we don't clear other instances' data.
 */
export class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private fileLock: FileLock;

  constructor() {
    this.fileLock = new FileLock(CONVERSATIONS_FILE);
    // Load any existing conversations from file into memory
    this.loadExistingConversations();
    // Start cleanup interval for timeout handling
    this.startCleanup();
  }

  /**
   * Load existing active conversations from file
   * This allows the Web UI to see conversations from all instances
   */
  private loadExistingConversations(): void {
    try {
      if (!fs.existsSync(CONVERSATIONS_FILE)) {
        return;
      }

      this.fileLock.acquireSync();
      try {
        const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf-8');
        const serialized: SerializedConversation[] = JSON.parse(data);

        // Clear existing to avoid duplicates if re-loading
        this.conversations.clear();

        // Load into memory map
        for (const conv of serialized) {
          const conversation: Conversation = {
            id: conv.id,
            model: conv.model,
            messages: conv.messages,
            systemPrompt: conv.systemPrompt,
            createdAt: new Date(conv.createdAt),
            lastActivityAt: new Date(conv.lastActivityAt),
          };
          this.conversations.set(conversation.id, conversation);
        }

        if (serialized.length > 0) {
          console.log(`[ConversationManager] Loaded ${serialized.length} existing conversations`);
        }
      } finally {
        this.fileLock.release();
      }
    } catch (error) {
      console.error('[ConversationManager] Failed to load existing conversations:', error);
    }
  }

  /**
   * Save conversations to file
   */
  private saveToFile(): void {
    try {
      // Reload first to merge potential changes from other processes
      if (fs.existsSync(CONVERSATIONS_FILE)) {
        this.fileLock.acquireSync();
        try {
          const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf-8');
          const serialized: SerializedConversation[] = JSON.parse(data);
          for (const conv of serialized) {
            // Keep existing ones from other processes if we don't have them
            if (!this.conversations.has(conv.id)) {
              this.conversations.set(conv.id, {
                id: conv.id,
                model: conv.model,
                messages: conv.messages,
                systemPrompt: conv.systemPrompt,
                createdAt: new Date(conv.createdAt),
                lastActivityAt: new Date(conv.lastActivityAt),
              });
            }
          }
        } catch (e) {
          // Ignore error on reload merge
        } finally {
          this.fileLock.release();
        }
      }

      const data: SerializedConversation[] = Array.from(this.conversations.values()).map(conv => ({
        id: conv.id,
        model: conv.model,
        messages: conv.messages,
        systemPrompt: conv.systemPrompt,
        createdAt: conv.createdAt.toISOString(),
        lastActivityAt: conv.lastActivityAt.toISOString(),
      }));

      // Ensure config directory exists
      const configDir = path.dirname(CONVERSATIONS_FILE);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      this.fileLock.acquireSync();
      try {
        const tempFile = CONVERSATIONS_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tempFile, CONVERSATIONS_FILE);
      } finally {
        this.fileLock.release();
      }
    } catch (error) {
      console.error('Failed to save conversations:', error);
    }
  }

  /**
   * Load conversations from file (static method for external use)
   */
  static loadFromFile(): Conversation[] {
    try {
      if (!fs.existsSync(CONVERSATIONS_FILE)) {
        return [];
      }

      const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf-8');
      const serialized: SerializedConversation[] = JSON.parse(data);

      return serialized.map(conv => ({
        id: conv.id,
        model: conv.model,
        messages: conv.messages,
        systemPrompt: conv.systemPrompt,
        createdAt: new Date(conv.createdAt),
        lastActivityAt: new Date(conv.lastActivityAt),
      }));
    } catch (error) {
      console.error('Failed to load conversations:', error);
      return [];
    }
  }

  /**
   * Load archived conversations from history file (static method for external use)
   */
  static loadHistoryFromFile(): ArchivedConversation[] {
    try {
      if (!fs.existsSync(HISTORY_FILE)) {
        return [];
      }

      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load conversation history:', error);
      return [];
    }
  }

  /**
   * Archive a conversation to history file
   */
  private archiveConversation(conversation: Conversation, reason: ArchivedConversation['endReason']): void {
    try {
      // Load existing history
      let history: ArchivedConversation[] = [];
      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
        history = JSON.parse(data);
      }

      // Add archived conversation
      const archived: ArchivedConversation = {
        id: conversation.id,
        model: conversation.model,
        messages: conversation.messages,
        systemPrompt: conversation.systemPrompt,
        createdAt: conversation.createdAt.toISOString(),
        lastActivityAt: conversation.lastActivityAt.toISOString(),
        endedAt: new Date().toISOString(),
        endReason: reason,
      };

      history.unshift(archived); // Add to beginning (newest first)

      // Keep only last 100 conversations
      if (history.length > 100) {
        history = history.slice(0, 100);
      }

      // Ensure config directory exists
      const configDir = path.dirname(HISTORY_FILE);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to archive conversation:', error);
    }
  }

  /**
   * Create a new conversation
   */
  create(model: ModelType, systemPrompt: string): Conversation {
    const conversation: Conversation = {
      id: uuidv4(),
      model,
      messages: [],
      systemPrompt,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    this.conversations.set(conversation.id, conversation);
    this.saveToFile();
    return conversation;
  }

  /**
   * Get a conversation by ID
   */
  get(conversationId: string): Conversation {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new ConversationError(
        `Conversation not found: ${conversationId}`,
        conversationId
      );
    }
    return conversation;
  }

  /**
   * Add a message to a conversation
   */
  addMessage(
    conversationId: string,
    role: Message['role'],
    content: string
  ): void {
    const conversation = this.get(conversationId);

    // Check message limit
    if (conversation.messages.length >= MAX_MESSAGES_LIMIT * 2) {
      throw new ConversationError(
        `Maximum message limit (${MAX_MESSAGES_LIMIT} exchanges) reached`,
        conversationId
      );
    }

    conversation.messages.push({ role, content });
    conversation.lastActivityAt = new Date();
    this.saveToFile();
  }

  /**
   * Check if conversation can continue
   */
  canContinue(conversationId: string): boolean {
    const conversation = this.get(conversationId);
    // Each exchange = 1 user + 1 assistant message = 2 messages
    // maxMessages represents exchanges, so multiply by 2
    return conversation.messages.length < MAX_MESSAGES_LIMIT * 2;
  }

  /**
   * Get message count for a conversation
   */
  getMessageCount(conversationId: string): number {
    const conversation = this.get(conversationId);
    return conversation.messages.length;
  }

  /**
   * End a conversation (archives it to history)
   */
  end(conversationId: string): number {
    const conversation = this.get(conversationId);
    const totalMessages = conversation.messages.length;

    // Archive before deleting
    this.archiveConversation(conversation, 'completed');

    this.conversations.delete(conversationId);
    this.saveToFile();
    return totalMessages;
  }

  /**
   * List all active conversations
   */
  listActive(): Conversation[] {
    return Array.from(this.conversations.values());
  }

  /**
   * Start periodic cleanup of stale conversations
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStale();
    }, 60000); // Check every minute
  }

  /**
   * Clean up stale conversations (archives them to history)
   */
  private cleanupStale(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, conversation] of this.conversations) {
      const age = now - conversation.lastActivityAt.getTime();
      if (age > CONVERSATION_TIMEOUT_MS) {
        // Archive before deleting
        this.archiveConversation(conversation, 'timeout');
        this.conversations.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.saveToFile();
    }
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.conversations.clear();
    this.saveToFile();
  }
}

// Singleton instance
export const conversationManager = new ConversationManager();
