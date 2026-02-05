import { Router } from 'express';
import { getConfigManager } from '../../config/index.js';
import { MODEL_TYPES } from '../../types/index.js';
import type { ModelType } from '../../types/index.js';
import { CONVERSATION_LIMITS } from '../../config/defaults.js';

const router = Router();

/**
 * GET /api/config - Get current configuration (with masked keys)
 */
router.get('/', (_req, res) => {
  try {
    const config = getConfigManager().getConfig();

    // Build safe response with masked keys
    const safeConfig = {
      defaultModel: config.defaultModel,
      maxMessages: config.maxMessages,
      requestTimeout: config.requestTimeout,
      availableModels: MODEL_TYPES,
      providers: Object.fromEntries(
        Object.entries(config.providers).map(([id, cfg]) => [
          id,
          {
            enabled: cfg.enabled,
            hasKey: !!cfg.apiKey,
          },
        ])
      ),
    };

    res.json(safeConfig);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PATCH /api/config - Update configuration (defaultModel, maxMessages)
 */
router.patch('/', async (req, res) => {
  try {
    const { defaultModel, maxMessages, requestTimeout } = req.body;
    const updates: { defaultModel?: ModelType; maxMessages?: number; requestTimeout?: number } = {};

    // Validate defaultModel
    if (defaultModel !== undefined) {
      if (!MODEL_TYPES.includes(defaultModel)) {
        res.status(400).json({
          error: 'Invalid model',
          message: `Model must be one of: ${MODEL_TYPES.join(', ')}`,
        });
        return;
      }
      updates.defaultModel = defaultModel;
    }

    // Validate maxMessages
    if (maxMessages !== undefined) {
      const num = parseInt(maxMessages, 10);
      if (isNaN(num) || num < 1 || num > CONVERSATION_LIMITS.MAX_ALLOWED_MESSAGES) {
        res.status(400).json({
          error: 'Invalid maxMessages',
          message: `maxMessages must be between 1 and ${CONVERSATION_LIMITS.MAX_ALLOWED_MESSAGES}`,
        });
        return;
      }
      updates.maxMessages = num;
    }

    // Validate requestTimeout
    if (requestTimeout !== undefined) {
      const num = parseInt(requestTimeout, 10);
      if (isNaN(num) || num < 30000 || num > 600000) {
        res.status(400).json({
          error: 'Invalid requestTimeout',
          message: 'requestTimeout must be between 30000 (30s) and 600000 (10min)',
        });
        return;
      }
      updates.requestTimeout = num;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        error: 'No updates provided',
        message: 'Provide at least one of: defaultModel, maxMessages, requestTimeout',
      });
      return;
    }

    await getConfigManager().update(updates);
    res.json({ success: true, updated: updates });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as configRoutes };
