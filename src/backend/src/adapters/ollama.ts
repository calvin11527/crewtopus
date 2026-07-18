import type { AgentAdapter, AdapterInput, AdapterOutput } from './base';
import { buildFullPrompt, estimateTokens } from './base';
import { DEFAULT_LOCAL_MODEL_ID } from '../modules/local-llm-catalog';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || DEFAULT_LOCAL_MODEL_ID;

const CODING_SYSTEM_PROMPT =
  'You are a software engineering assistant in AgentHub. Follow instructions precisely, write clean code, and explain trade-offs when asked.';

interface OllamaChatResponse {
  message?: { content?: string };
  eval_count?: number;
}

interface OllamaGenerateResponse {
  response?: string;
  eval_count?: number;
}

/** Adapter for local Ollama inference via HTTP API. */
export class OllamaAdapter implements AgentAdapter {
  readonly type = 'ollama' as const;

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async execute(input: AdapterInput): Promise<AdapterOutput> {
    const prompt = buildFullPrompt(input);
    const model = (input.config?.model as string) || DEFAULT_MODEL;
    const numCtx = typeof input.config?.numCtx === 'number' ? input.config.numCtx : 8192;

    const { content, evalCount } = await this.generate(model, prompt, numCtx);

    return {
      content,
      tokenCount: evalCount || estimateTokens(prompt) + estimateTokens(content),
      metadata: { adapter: 'ollama', model, host: OLLAMA_HOST, api: 'chat' },
    };
  }

  private async generate(model: string, prompt: string, numCtx: number): Promise<{ content: string; evalCount?: number }> {
    const chatRes = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CODING_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: { num_ctx: numCtx },
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (chatRes.ok) {
      const data = (await chatRes.json()) as OllamaChatResponse;
      return {
        content: data.message?.content?.trim() || '',
        evalCount: data.eval_count,
      };
    }

    const generateRes = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${CODING_SYSTEM_PROMPT}\n\n${prompt}`,
        stream: false,
        options: { num_ctx: numCtx },
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!generateRes.ok) {
      const err = await generateRes.text();
      throw new Error(`Ollama API failed (${generateRes.status}): ${err}`);
    }

    const data = (await generateRes.json()) as OllamaGenerateResponse;
    return {
      content: data.response?.trim() || '',
      evalCount: data.eval_count,
    };
  }

  shutdown(): void {
    /* no-op */
  }
}