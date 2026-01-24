import Database from 'better-sqlite3';
import path from 'path';
import { CONFIG_DIR } from './utils/lock.js';

const DB_PATH = path.join(CONFIG_DIR, 'data.db');

let db: Database.Database | null = null;

/**
 * Initialize SQLite database with WAL mode
 */
export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for concurrent reads
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Create tables
  db.exec(`
    -- Conversations table
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      system_prompt TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      end_reason TEXT CHECK(end_reason IN ('completed', 'timeout', 'manual', NULL)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Config table (key-value store)
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Connected clients table (for tracking)
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status);
    CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at);
  `);

  return db;
}

/**
 * Get database instance
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Conversation types
export interface DbConversation {
  id: string;
  model: string;
  system_prompt: string | null;
  status: 'active' | 'archived';
  end_reason: 'completed' | 'timeout' | 'manual' | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface DbMessage {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

// Conversation CRUD operations
export const conversationQueries = {
  create: (database: Database.Database): Database.Statement =>
    database.prepare(`
      INSERT INTO conversations (id, model, system_prompt, status)
      VALUES (@id, @model, @systemPrompt, 'active')
    `),

  getById: (database: Database.Database): Database.Statement =>
    database.prepare(`SELECT * FROM conversations WHERE id = ?`),

  getActive: (database: Database.Database): Database.Statement =>
    database.prepare(`
      SELECT * FROM conversations
      WHERE status = 'active'
      ORDER BY updated_at DESC
    `),

  getArchived: (database: Database.Database): Database.Statement =>
    database.prepare(`
      SELECT * FROM conversations
      WHERE status = 'archived'
      ORDER BY ended_at DESC
    `),

  archive: (database: Database.Database): Database.Statement =>
    database.prepare(`
      UPDATE conversations
      SET status = 'archived',
          end_reason = @endReason,
          ended_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `),

  touch: (database: Database.Database): Database.Statement =>
    database.prepare(`
      UPDATE conversations
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `),

  deleteConversation: (database: Database.Database): Database.Statement =>
    database.prepare(`DELETE FROM conversations WHERE id = ?`),

  // Get stale active conversations (not updated in X minutes)
  getStaleActive: (database: Database.Database): Database.Statement =>
    database.prepare(`
      SELECT * FROM conversations
      WHERE status = 'active'
        AND datetime(updated_at) < datetime('now', '-' || ? || ' minutes')
    `),

  // Archive all stale conversations at once
  archiveStale: (database: Database.Database): Database.Statement =>
    database.prepare(`
      UPDATE conversations
      SET status = 'archived',
          end_reason = 'timeout',
          ended_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'active'
        AND datetime(updated_at) < datetime('now', '-' || ? || ' minutes')
    `),
};

// Message CRUD operations
export const messageQueries = {
  create: (database: Database.Database): Database.Statement =>
    database.prepare(`
      INSERT INTO messages (conversation_id, role, content)
      VALUES (@conversationId, @role, @content)
    `),

  getByConversation: (database: Database.Database): Database.Statement =>
    database.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `),

  getLastN: (database: Database.Database): Database.Statement =>
    database.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
};

// Config CRUD operations
export const configQueries = {
  get: (database: Database.Database): Database.Statement =>
    database.prepare(`SELECT value FROM config WHERE key = ?`),

  set: (database: Database.Database): Database.Statement =>
    database.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (@key, @value, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = @value,
        updated_at = CURRENT_TIMESTAMP
    `),

  getAll: (database: Database.Database): Database.Statement =>
    database.prepare(`SELECT key, value FROM config`),

  deleteConfig: (database: Database.Database): Database.Statement =>
    database.prepare(`DELETE FROM config WHERE key = ?`),
};

export { DB_PATH };
