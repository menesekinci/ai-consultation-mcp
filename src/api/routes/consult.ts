import { Router, type Request, type Response } from 'express';
import { getProviderClient } from '../../daemon/handlers/provider.js';
import { getConfig } from '../../daemon/handlers/config.js';
import { retrieveContext } from '../../rag/retrieval.js';
import type { ModelType } from '../../types/index.js';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const message = (req.body?.message as string | undefined)?.trim();
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const model = (req.body?.model as string | undefined) || getConfig().defaultModel;
    const useRag = req.body?.useRag === true;
    const systemPrompt = (req.body?.systemPrompt as string | undefined)?.trim();

    // Build messages
    const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];

    let ragContext: string | undefined;

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    if (useRag) {
      const rag = await retrieveContext(message);
      if (rag.context) {
        ragContext = rag.context;
        messages.push({ role: 'system', content: rag.context });
      }
    }

    messages.push({ role: 'user', content: message });

    const client = getProviderClient(model as ModelType);
    if (!client) {
      res.status(400).json({ error: `Provider not configured for model: ${model}` });
      return;
    }

    const response = await client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role as any, content: m.content })),
    });

    const content = response.choices[0]?.message?.content || '';
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined;

    res.json({
      response: content,
      model: response.model || model,
      usage,
      ...(ragContext ? { ragContext } : {}),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Consultation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as consultRoutes };
