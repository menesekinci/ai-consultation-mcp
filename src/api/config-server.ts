import { getConfigManager } from '../config/index.js';
import { logger } from '../utils/index.js';

export interface ConfigUIOptions {
  port?: number;
  openBrowser?: boolean;
}

export async function startConfigUI(_options: ConfigUIOptions = {}): Promise<void> {
  const configManager = getConfigManager();
  await configManager.init();
  
  console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   AI Consultation MCP - Configuration            │
│                                                 │
│   Config file: ~/.ai-consultation-mcp/config.json│
│                                                 │
│   Environment variables:                        │
│   - DEEPSEEK_API_KEY                           │
│   - OPENAI_API_KEY                             │
│                                                 │
└─────────────────────────────────────────────────┘
`);

  loadEnvVariables();
}

function loadEnvVariables(): void {
  const configManager = getConfigManager();
  const config = configManager.getConfig();
  const updates: Record<string, unknown> = {};

  if (process.env.DEEPSEEK_API_KEY) {
    updates.providers = {
      ...config.providers,
      deepseek: {
        ...config.providers.deepseek,
        enabled: true,
        apiKey: process.env.DEEPSEEK_API_KEY,
      },
    };
  }

  if (process.env.OPENAI_API_KEY) {
    updates.providers = {
      ...(updates.providers || config.providers),
      openai: {
        ...config.providers.openai,
        enabled: true,
        apiKey: process.env.OPENAI_API_KEY,
      },
    };
  }

  if (Object.keys(updates).length > 0) {
    configManager.update(updates as Parameters<typeof configManager.update>[0])
      .then(() => {
        logger.info('Configuration updated from environment variables');
        console.log('✅ Environment variables loaded into config');
      })
      .catch((err) => {
        logger.error('Failed to update config from env vars', { error: err.message });
      });
  }
}
