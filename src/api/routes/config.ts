import { Router } from 'express';
import { getConfigManager } from '../../config/index.js';
import { parseConfigPatch, toPublicConfig } from '../shared/config.js';

const router = Router();

/**
 * GET /api/config - Get current configuration (with masked keys)
 */
router.get('/', (_req, res) => {
  try {
    const config = getConfigManager().getConfig();
    res.json(toPublicConfig(config));
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
    const parsed = parseConfigPatch(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid configuration update',
        message: parsed.error,
      });
      return;
    }

    await getConfigManager().update(parsed.data);
    res.json({ success: true, updated: parsed.data });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update configuration',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as configRoutes };
