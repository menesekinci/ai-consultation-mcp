import { Router } from 'express';
import { getConfigManager } from '../../config/index.js';
import type { ProviderType } from '../../types/index.js';
import { logger } from '../../utils/index.js';
import {
  isProviderType,
  PROVIDER_INFO,
  listProviderDetails,
  getProviderDetails,
  maskKey,
} from '../shared/providers.js';

const router = Router();

/**
 * GET /api/providers - List all providers with status
 */
router.get('/', (_req, res) => {
  try {
    const config = getConfigManager().getConfig();
    res.json(listProviderDetails(config));
  } catch (error) {
    res.status(500).json({
      error: 'Failed to list providers',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/providers/:id - Get single provider details
 */
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;

    if (!isProviderType(id)) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    const config = getConfigManager().getConfig();
    res.json(getProviderDetails(config, id));
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get provider',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/providers/:id - Set provider API key
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req.body;

    if (!isProviderType(id)) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      res.status(400).json({
        error: 'Invalid API key',
        message: 'API key is required and must be a non-empty string',
      });
      return;
    }

    await getConfigManager().setProviderKey(id, apiKey.trim());

    logger.info(`API key updated for provider: ${id}`);

    res.json({
      success: true,
      provider: id,
      maskedKey: maskKey(apiKey.trim()),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to set API key',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/providers/:id - Remove provider API key
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isProviderType(id)) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    await getConfigManager().removeProviderKey(id);

    logger.info(`API key removed for provider: ${id}`);

    res.json({
      success: true,
      provider: id,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to remove API key',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/providers/:id/test - Test API key validity
 * Makes a minimal API call to verify the key works
 */
router.post('/:id/test', async (req, res) => {
  try {
    const { id } = req.params;
    const { apiKey } = req.body;

    if (!isProviderType(id)) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    // Use provided apiKey or stored key
    const config = getConfigManager().getConfig();
    const keyToTest = apiKey || config.providers[id]?.apiKey;

    if (!keyToTest) {
      res.json({
        valid: false,
        message: 'No API key provided or configured',
      });
      return;
    }

    // Test the API key with a minimal request
    const testResult = await testProviderApiKey(id, keyToTest);

    res.json(testResult);
  } catch (error) {
    res.json({
      valid: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Test provider API key by making a minimal API call
 */
async function testProviderApiKey(
  providerId: ProviderType,
  apiKey: string
): Promise<{ valid: boolean; message: string }> {
  try {
    const { default: OpenAI } = await import('openai');

    // Configure client based on provider
    const clientOptions: { apiKey: string; baseURL?: string } = { apiKey };
    if (providerId === 'deepseek') {
      clientOptions.baseURL = 'https://api.deepseek.com';
    }

    const client = new OpenAI(clientOptions);
    await client.models.list();

    const providerName = PROVIDER_INFO[providerId].name;
    return { valid: true, message: `${providerName} API key is valid` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Check for common auth errors
    if (
      message.includes('401') ||
      message.includes('403') ||
      message.includes('Unauthorized') ||
      message.includes('Invalid API Key') ||
      message.includes('authentication')
    ) {
      return { valid: false, message: 'Invalid API key: Authentication failed' };
    }

    // Rate limit is actually a valid key
    if (message.includes('429') || message.includes('rate limit')) {
      return { valid: true, message: 'API key is valid (rate limited)' };
    }

    return { valid: false, message: `API test failed: ${message}` };
  }
}

export { router as providerRoutes };
