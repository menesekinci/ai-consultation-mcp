import { z } from 'zod';
import { MODEL_TYPES } from '../types/index.js';

/**
 * Provider configuration schema
 */
export const providerConfigSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().optional(),
});

/**
 * Full configuration schema
 */
export const configSchema = z.object({
  defaultModel: z.enum(MODEL_TYPES),
  maxMessages: z.number().int().min(1).max(10),
  providers: z.object({
    deepseek: providerConfigSchema,
    openai: providerConfigSchema,
  }),
});

/**
 * Consultation modes for specialized system prompts
 */
export const CONSULTATION_MODES = [
  'debug',
  'analyzeCode',
  'reviewArchitecture',
  'validatePlan',
  'explainConcept',
  'general',
] as const;

export type ConsultationMode = (typeof CONSULTATION_MODES)[number];

/**
 * Consult request schema (for tool input validation)
 */
export const consultRequestSchema = z.object({
  question: z.string().min(1, 'Question is required'),
  model: z.enum(MODEL_TYPES).optional(),
  mode: z.enum(CONSULTATION_MODES).optional(),
  context: z.string().optional(),
});

/**
 * Continue conversation request schema
 */
export const continueRequestSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation ID'),
  message: z.string().min(1, 'Message is required'),
});

/**
 * End conversation request schema
 */
export const endRequestSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation ID'),
});

/**
 * Type exports from schemas
 */
export type ValidatedConfig = z.infer<typeof configSchema>;
export type ValidatedConsultRequest = z.infer<typeof consultRequestSchema>;
export type ValidatedContinueRequest = z.infer<typeof continueRequestSchema>;
export type ValidatedEndRequest = z.infer<typeof endRequestSchema>;
