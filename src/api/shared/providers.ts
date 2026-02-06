import type { Config, ProviderType, ModelType } from '../../types/index.js';
import { MODEL_TO_PROVIDER, MODEL_CONFIG } from '../../types/index.js';

export const PROVIDER_INFO: Record<ProviderType, { name: string; description: string }> = {
  deepseek: {
    name: 'DeepSeek',
    description: 'DeepSeek Chat and Reasoner models',
  },
  openai: {
    name: 'ChatGPT',
    description: 'GPT-5.2 and GPT-5.2 Pro models',
  },
};

export function isProviderType(id: string): id is ProviderType {
  return id in PROVIDER_INFO;
}

export function getModelsForProvider(providerId: ProviderType): ModelType[] {
  return Object.entries(MODEL_TO_PROVIDER)
    .filter(([, provider]) => provider === providerId)
    .map(([model]) => model as ModelType);
}

export function maskKey(key: string): string {
  if (key.length <= 4) return '••••••••';
  return '••••••••' + key.slice(-4);
}

export interface ProviderDetails {
  id: ProviderType;
  name: string;
  description: string;
  enabled: boolean;
  hasKey: boolean;
  maskedKey: string | null;
  models: Array<{ id: ModelType; name: ModelType; isReasoning: boolean }>;
}

export function getProviderDetails(config: Config, providerId: ProviderType): ProviderDetails {
  const providerConfig = config.providers[providerId];
  const models = getModelsForProvider(providerId);

  return {
    id: providerId,
    name: PROVIDER_INFO[providerId].name,
    description: PROVIDER_INFO[providerId].description,
    enabled: providerConfig?.enabled ?? false,
    hasKey: !!providerConfig?.apiKey,
    maskedKey: providerConfig?.apiKey ? maskKey(providerConfig.apiKey) : null,
    models: models.map((m) => ({
      id: m,
      name: m,
      isReasoning: MODEL_CONFIG[m]?.isReasoning ?? false,
    })),
  };
}

export function listProviderDetails(config: Config): ProviderDetails[] {
  return (Object.keys(PROVIDER_INFO) as ProviderType[]).map((id) =>
    getProviderDetails(config, id)
  );
}
