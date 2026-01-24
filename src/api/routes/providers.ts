import { Router } from 'express';
import { getConfigManager } from '../../config/index.js';
import { MODEL_TO_PROVIDER, MODEL_CONFIG } from '../../types/index.js';
import type { ProviderType, ModelType } from '../../types/index.js';
import { logger } from '../../utils/index.js';

const router = Router();

/**
 * Provider display information
 */
const PROVIDER_INFO: Record<ProviderType, { name: string; description: string }> = {
  deepseek: {
    name: 'DeepSeek',
    description: 'DeepSeek Chat and Reasoner models',
  },
  openai: {
    name: 'ChatGPT',
    description: 'GPT-5.2 and GPT-5.2 Pro models',
  },
};

/**
 * Get models for a specific provider
 */
function getModelsForProvider(providerId: ProviderType): ModelType[] {
  return Object.entries(MODEL_TO_PROVIDER)
    .filter(([_, provider]) => provider === providerId)
    .map(([model]) => model as ModelType);
}

/**
 * Mask API key for display (fixed length + last 4 characters)
 */
function maskKey(key: string): string {
  if (key.length <= 4) return '••••••••';
  return '••••••••' + key.slice(-4);
}

/**
 * GET /api/providers - List all providers with status
 */
router.get('/', (_req, res) => {
  try {
    const config = getConfigManager().getConfig();

    const providers = (Object.keys(PROVIDER_INFO) as ProviderType[]).map((id) => {
      const providerConfig = config.providers[id];
      const models = getModelsForProvider(id);

      return {
        id,
        name: PROVIDER_INFO[id].name,
        description: PROVIDER_INFO[id].description,
        enabled: providerConfig?.enabled ?? false,
        hasKey: !!providerConfig?.apiKey,
        maskedKey: providerConfig?.apiKey ? maskKey(providerConfig.apiKey) : null,
        models: models.map((m) => ({
          id: m,
          name: m,
          isReasoning: MODEL_CONFIG[m]?.isReasoning ?? false,
        })),
      };
    });

    res.json(providers);
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

    if (!PROVIDER_INFO[id as ProviderType]) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    const config = getConfigManager().getConfig();
    const providerConfig = config.providers[id as ProviderType];
    const models = getModelsForProvider(id as ProviderType);

    res.json({
      id,
      name: PROVIDER_INFO[id as ProviderType].name,
      description: PROVIDER_INFO[id as ProviderType].description,
      enabled: providerConfig?.enabled ?? false,
      hasKey: !!providerConfig?.apiKey,
      maskedKey: providerConfig?.apiKey ? maskKey(providerConfig.apiKey) : null,
      models: models.map((m) => ({
        id: m,
        name: m,
        isReasoning: MODEL_CONFIG[m]?.isReasoning ?? false,
      })),
    });
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

    if (!PROVIDER_INFO[id as ProviderType]) {
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

    await getConfigManager().setProviderKey(id as ProviderType, apiKey.trim());

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

    if (!PROVIDER_INFO[id as ProviderType]) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    await getConfigManager().removeProviderKey(id as ProviderType);

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

    if (!PROVIDER_INFO[id as ProviderType]) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }

    // Use provided apiKey or stored key
    const config = getConfigManager().getConfig();
    const keyToTest = apiKey || config.providers[id as ProviderType]?.apiKey;

    if (!keyToTest) {
      res.json({
        valid: false,
        message: 'No API key provided or configured',
      });
      return;
    }

    // Test the API key with a minimal request
    const testResult = await testProviderApiKey(id as ProviderType, keyToTest);

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
