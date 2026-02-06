import { z } from 'zod';
import { MODEL_TYPES } from '../../types/index.js';
import type { Config, ModelType } from '../../types/index.js';
import { CONVERSATION_LIMITS } from '../../config/defaults.js';

const configPatchSchema = z
  .object({
    defaultModel: z.enum(MODEL_TYPES).optional(),
    maxMessages: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONVERSATION_LIMITS.MAX_ALLOWED_MESSAGES)
      .optional(),
    requestTimeout: z.coerce.number().int().min(30000).max(600000).optional(),
    autoOpenWebUI: z.coerce.boolean().optional(),
  })
  .strict();

export type ConfigPatchInput = z.input<typeof configPatchSchema>;

export function parseConfigPatch(input: unknown): {
  success: true;
  data: { defaultModel?: ModelType; maxMessages?: number; requestTimeout?: number; autoOpenWebUI?: boolean };
} | {
  success: false;
  error: string;
} {
  const result = configPatchSchema.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues[0]?.message ?? 'Invalid configuration payload',
    };
  }

  const parsed = result.data;
  if (Object.keys(parsed).length === 0) {
    return {
      success: false,
      error: 'No updates provided',
    };
  }

  return {
    success: true,
    data: parsed,
  };
}

export function toPublicConfig(config: Config): {
  defaultModel: ModelType;
  maxMessages: number;
  requestTimeout: number;
  autoOpenWebUI: boolean;
  availableModels: readonly ModelType[];
  providers: Record<string, { enabled: boolean; hasKey: boolean }>;
} {
  return {
    defaultModel: config.defaultModel,
    maxMessages: config.maxMessages,
    requestTimeout: config.requestTimeout,
    autoOpenWebUI: config.autoOpenWebUI,
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
}
