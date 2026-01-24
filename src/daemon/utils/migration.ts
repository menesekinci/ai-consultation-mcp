import fs from 'fs';
import path from 'path';
import { CONFIG_DIR } from './lock.js';
import {
  getDatabase,
  conversationQueries,
  messageQueries,
  configQueries,
} from '../database.js';

const JSON_CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const JSON_CONVERSATIONS_PATH = path.join(CONFIG_DIR, 'conversations.json');
const JSON_HISTORY_PATH = path.join(CONFIG_DIR, 'conversation_history.json');
const MIGRATION_FLAG = path.join(CONFIG_DIR, '.migrated');

interface OldConfig {
  defaultModel?: string;
  maxMessages?: number;
  requestTimeout?: number;
  providers?: {
    deepseek?: { enabled?: boolean; apiKey?: string };
    openai?: { enabled?: boolean; apiKey?: string };
  };
}

interface OldMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface OldConversation {
  id: string;
  model: string;
  systemPrompt?: string;
  messages: OldMessage[];
  createdAt: string;
  updatedAt: string;
}

interface OldHistoryEntry {
  id: string;
  model: string;
  messages: OldMessage[];
  endReason?: string;
  startedAt: string;
  endedAt: string;
}

/**
 * Check if migration has already been done
 */
export function isMigrated(): boolean {
  return fs.existsSync(MIGRATION_FLAG);
}

/**
 * Mark migration as complete
 */
function markMigrated(): void {
  fs.writeFileSync(MIGRATION_FLAG, new Date().toISOString());
}

/**
 * Backup old JSON files
 */
function backupJsonFiles(): void {
  const backupDir = path.join(CONFIG_DIR, 'backup');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = Date.now();

  if (fs.existsSync(JSON_CONFIG_PATH)) {
    fs.copyFileSync(JSON_CONFIG_PATH, path.join(backupDir, `config.${timestamp}.json`));
  }
  if (fs.existsSync(JSON_CONVERSATIONS_PATH)) {
    fs.copyFileSync(JSON_CONVERSATIONS_PATH, path.join(backupDir, `conversations.${timestamp}.json`));
  }
  if (fs.existsSync(JSON_HISTORY_PATH)) {
    fs.copyFileSync(JSON_HISTORY_PATH, path.join(backupDir, `history.${timestamp}.json`));
  }
}

/**
 * Migrate config from JSON to SQLite
 */
function migrateConfig(): void {
  if (!fs.existsSync(JSON_CONFIG_PATH)) {
    console.log('[Migration] No config.json found, skipping config migration');
    return;
  }

  try {
    const content = fs.readFileSync(JSON_CONFIG_PATH, 'utf-8');
    const config: OldConfig = JSON.parse(content);
    const db = getDatabase();
    const setQuery = configQueries.set(db);

    if (config.defaultModel) {
      setQuery.run({ key: 'defaultModel', value: config.defaultModel });
    }
    if (config.maxMessages) {
      setQuery.run({ key: 'maxMessages', value: String(config.maxMessages) });
    }
    if (config.requestTimeout) {
      setQuery.run({ key: 'requestTimeout', value: String(config.requestTimeout) });
    }
    if (config.providers) {
      setQuery.run({ key: 'providers', value: JSON.stringify(config.providers) });
    }

    console.log('[Migration] Config migrated successfully');
  } catch (error) {
    console.error('[Migration] Failed to migrate config:', error);
  }
}

/**
 * Migrate active conversations from JSON to SQLite
 */
function migrateActiveConversations(): void {
  if (!fs.existsSync(JSON_CONVERSATIONS_PATH)) {
    console.log('[Migration] No conversations.json found, skipping active conversations migration');
    return;
  }

  try {
    const content = fs.readFileSync(JSON_CONVERSATIONS_PATH, 'utf-8');
    const conversations: OldConversation[] = JSON.parse(content);
    const db = getDatabase();

    let migrated = 0;
    for (const conv of conversations) {
      try {
        // Create conversation
        conversationQueries.create(db).run({
          id: conv.id,
          model: conv.model,
          systemPrompt: conv.systemPrompt ?? null,
        });

        // Add messages
        for (const msg of conv.messages) {
          messageQueries.create(db).run({
            conversationId: conv.id,
            role: msg.role,
            content: msg.content,
          });
        }

        migrated++;
      } catch (error) {
        console.warn(`[Migration] Failed to migrate conversation ${conv.id}:`, error);
      }
    }

    console.log(`[Migration] Migrated ${migrated}/${conversations.length} active conversations`);
  } catch (error) {
    console.error('[Migration] Failed to migrate active conversations:', error);
  }
}

/**
 * Migrate history from JSON to SQLite
 */
function migrateHistory(): void {
  if (!fs.existsSync(JSON_HISTORY_PATH)) {
    console.log('[Migration] No conversation_history.json found, skipping history migration');
    return;
  }

  try {
    const content = fs.readFileSync(JSON_HISTORY_PATH, 'utf-8');
    const history: OldHistoryEntry[] = JSON.parse(content);
    const db = getDatabase();

    // Track unique IDs to avoid duplicates
    const seenIds = new Set<string>();

    let migrated = 0;
    for (const entry of history) {
      // Skip duplicates
      if (seenIds.has(entry.id)) {
        continue;
      }
      seenIds.add(entry.id);

      try {
        // Check if already exists
        const existing = conversationQueries.getById(db).get(entry.id);
        if (existing) {
          continue;
        }

        // Create archived conversation
        conversationQueries.create(db).run({
          id: entry.id,
          model: entry.model,
          systemPrompt: null,
        });

        // Add messages
        for (const msg of entry.messages) {
          messageQueries.create(db).run({
            conversationId: entry.id,
            role: msg.role,
            content: msg.content,
          });
        }

        // Archive it
        conversationQueries.archive(db).run({
          id: entry.id,
          endReason: entry.endReason || 'manual',
        });

        migrated++;
      } catch (error) {
        console.warn(`[Migration] Failed to migrate history entry ${entry.id}:`, error);
      }
    }

    console.log(`[Migration] Migrated ${migrated}/${history.length} history entries`);
  } catch (error) {
    console.error('[Migration] Failed to migrate history:', error);
  }
}

/**
 * Run full migration from JSON to SQLite
 */
export function runMigration(): void {
  if (isMigrated()) {
    console.log('[Migration] Already migrated, skipping');
    return;
  }

  console.log('[Migration] Starting migration from JSON to SQLite...');

  // Backup first
  backupJsonFiles();

  // Migrate each component
  migrateConfig();
  migrateActiveConversations();
  migrateHistory();

  // Mark as done
  markMigrated();

  console.log('[Migration] Migration complete');
}
