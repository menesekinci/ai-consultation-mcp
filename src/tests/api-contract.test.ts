import { describe, expect, it } from 'vitest';
import { parseConfigPatch, toPublicConfig } from '../api/shared/config.js';
import { listProviderDetails } from '../api/shared/providers.js';
import { buildChatHistoryResponse } from '../api/shared/chat.js';
import type { Config } from '../types/index.js';

const mockConfig: Config = {
  defaultModel: 'deepseek-reasoner',
  maxMessages: 5,
  requestTimeout: 180000,
  autoOpenWebUI: false,
  providers: {
    deepseek: { enabled: true, apiKey: 'deepseek-key' },
    openai: { enabled: false },
  },
};

describe('shared API contracts', () => {
  it('serializes public config in a stable shape', () => {
    const result = toPublicConfig(mockConfig);
    expect(result).toMatchObject({
      defaultModel: 'deepseek-reasoner',
      maxMessages: 5,
      requestTimeout: 180000,
      autoOpenWebUI: false,
      providers: {
        deepseek: { enabled: true, hasKey: true },
        openai: { enabled: false, hasKey: false },
      },
    });
  });

  it('parses valid config patch and rejects empty payload', () => {
    const valid = parseConfigPatch({ maxMessages: '7' });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.maxMessages).toBe(7);
    }

    const empty = parseConfigPatch({});
    expect(empty.success).toBe(false);
  });

  it('lists provider details with masked keys', () => {
    const providers = listProviderDetails(mockConfig);
    const deepseek = providers.find((p) => p.id === 'deepseek');
    expect(deepseek).toMatchObject({
      id: 'deepseek',
      hasKey: true,
      maskedKey: '••••••••-key',
    });
  });

  it('builds matching chat history response for active and archived lists', () => {
    const history = buildChatHistoryResponse(
      [
        {
          id: 'active-1',
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'hello' }],
          createdAt: new Date('2025-01-01T10:00:00.000Z'),
          lastActivityAt: new Date('2025-01-01T10:01:00.000Z'),
        },
      ],
      [
        {
          id: 'archived-1',
          model: 'gpt-5.2',
          messages: [{ role: 'assistant', content: 'done' }],
          createdAt: '2025-01-01T09:00:00.000Z',
          lastActivityAt: '2025-01-01T09:01:00.000Z',
          endedAt: '2025-01-01T09:02:00.000Z',
          endReason: 'manual',
        },
      ]
    );

    expect(history.count).toBe(2);
    expect(history.activeCount).toBe(1);
    expect(history.archivedCount).toBe(1);
    expect(history.conversations).toHaveLength(2);
    expect(history.active[0]?.status).toBe('active');
    expect(history.archived[0]?.status).toBe('archived');
  });
});
