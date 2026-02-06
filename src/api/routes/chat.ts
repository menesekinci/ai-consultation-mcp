import { Router, type Request, type Response } from 'express';
import { ConversationManager, conversationManager, type Conversation, type ArchivedConversation } from '../../server/conversation.js';
import { buildChatHistoryResponse } from '../shared/chat.js';

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

    res.json(
      buildChatHistoryResponse(
        activeConversations as Conversation[],
        archivedConversations as ArchivedConversation[]
      )
    );
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch conversation history',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/chat/archived/all
 * Delete all archived conversations from file history
 */
router.delete('/archived/all', (_req: Request, res: Response) => {
  try {
    const deleted = ConversationManager.deleteAllArchived();
    res.json({ success: true, deleted });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete archived conversations',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/chat/:id
 * Delete a single archived conversation from file history
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = ConversationManager.deleteArchivedById(String(id));
    if (!deleted) {
      res.status(404).json({ error: 'Conversation not found or already removed' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete conversation',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
