import fs from 'fs';
import os from 'os';
import path from 'path';
import { listAgents, updateAgentConfig } from '../modules/agent-registry';
import {
  listModelsForAgentType,
  listRecommendedLocalModels,
  resolveModelForAgent,
  validateAgentModel,
} from '../modules/agent-models';
import { DEFAULT_LOCAL_MODEL_ID } from '../modules/local-llm-catalog';

describe('agent-models', () => {
  let grokHome: string;
  let previousGrokHome: string | undefined;

  beforeEach(() => {
    grokHome = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-models-'));
    previousGrokHome = process.env.GROK_HOME;
    process.env.GROK_HOME = grokHome;
  });

  afterEach(() => {
    if (previousGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = previousGrokHome;
    fs.rmSync(grokHome, { recursive: true, force: true });
  });

  it('reads grok models from models_cache.json', async () => {
    fs.mkdirSync(path.join(grokHome), { recursive: true });
    fs.writeFileSync(
      path.join(grokHome, 'models_cache.json'),
      JSON.stringify({
        models: {
          'grok-build': { info: { id: 'grok-build', name: 'Grok Build', description: 'Build model' } },
          'grok-composer-2.5-fast': {
            info: { id: 'grok-composer-2.5-fast', name: 'Composer 2.5 Fast', description: 'Fast coder' },
          },
        },
      })
    );

    const models = await listModelsForAgentType('grok');
    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(['grok-build', 'grok-composer-2.5-fast']));
  });

  it('resolves per-agent model from config', () => {
    const grok = listAgents().find((a) => a.type === 'grok');
    expect(grok).toBeDefined();
    updateAgentConfig(grok!.id, { model: 'grok-build' });

    expect(resolveModelForAgent(grok!.id, 'grok')).toBe('grok-build');
    expect(resolveModelForAgent(undefined, 'grok')).toBe('grok-composer-2.5-fast');
  });

  it('validates model config values', () => {
    expect(validateAgentModel('grok', 'grok-build')).toBeNull();
    expect(validateAgentModel('grok', '')).toBeNull();
    expect(validateAgentModel('grok', 42)).toBe('model must be a non-empty string');
  });

  it('returns curated ollama catalog when Ollama is offline', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;

    const models = await listModelsForAgentType('ollama');
    expect(models.some((m) => m.id === DEFAULT_LOCAL_MODEL_ID && m.recommended)).toBe(true);

    global.fetch = originalFetch;
  });

  it('marks installed models from Ollama tags', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'gemma4:26b-mlx' }] }),
    }) as unknown as typeof fetch;

    const models = await listModelsForAgentType('ollama');
    const installed = models.find((m) => m.id === 'gemma4:26b-mlx');
    expect(installed?.installed).toBe(true);

    global.fetch = originalFetch;
  });

  it('lists recommended local models with install status', async () => {
    const recs = await listRecommendedLocalModels();
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => typeof r.installed === 'boolean')).toBe(true);
  });
});