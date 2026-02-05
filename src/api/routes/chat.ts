import { Router, type Request, type Response } from 'express';
import { ConversationManager, conversationManager, type Conversation, type ArchivedConversation } from '../../server/conversation.js';
import type { Message } from '../../types/index.js';

const router = Router();

/**
 * GET /api/chat/history
 * Returns all conversations (active + archived) from files
 */
router.get('/history', (_req: Request, res: Response) => {
  try {
    // Load active conversations from both in-memory (runtime) and file
    const inMemoryActive = conversationManager.listActive();
    const fileActive = ConversationManager.loadFromFile();

    // Merge and dedupe by ID (in-memory takes precedence)
    const activeMap = new Map<string, Conversation>();
    [...fileActive, ...inMemoryActive].forEach((conv) => {
      activeMap.set(conv.id, conv);
    });
    const activeConversations = Array.from(activeMap.values());

    // Load archived conversations and dedupe
    const archivedRaw = ConversationManager.loadHistoryFromFile();

    // Get active IDs to exclude from archived (active takes precedence)
    const activeIds = new Set(activeConversations.map((c) => c.id));

    // Dedupe archived: keep only first occurrence (newest) and exclude active ones
    const archivedMap = new Map<string, ArchivedConversation>();
    archivedRaw.forEach((conv) => {
      if (!activeIds.has(conv.id) && !archivedMap.has(conv.id)) {
        archivedMap.set(conv.id, conv);
      }
    });
    const archivedConversations = Array.from(archivedMap.values());

    // Format active conversations for UI display
    const active = activeConversations.map((conv: Conversation) => ({
      id: conv.id,
      model: conv.model,
      messageCount: conv.messages.length,
      messages: conv.messages.map((msg: Message, idx: number) => ({
        id: `${conv.id}-${idx}`,
        role: msg.role,
        content: msg.content,
      })),
      createdAt: conv.createdAt.toISOString(),
      lastActivityAt: conv.lastActivityAt.toISOString(),
      status: 'active' as const,
    }));

    // Format archived conversations for UI display
    const archived = archivedConversations.map((conv: ArchivedConversation) => ({
      id: conv.id,
      model: conv.model,
      messageCount: conv.messages.length,
      messages: conv.messages.map((msg: Message, idx: number) => ({
        id: `${conv.id}-${idx}`,
        role: msg.role,
        content: msg.content,
      })),
      createdAt: conv.createdAt,
      lastActivityAt: conv.lastActivityAt,
      endedAt: conv.endedAt,
      endReason: conv.endReason,
      status: 'archived' as const,
    }));

    // Combine: active first, then archived (already sorted by newest first)
    const allConversations = [...active, ...archived];

    res.json({
      count: allConversations.length,
      activeCount: active.length,
      archivedCount: archived.length,
      active,
      archived,
      conversations: allConversations,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch conversation history',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
