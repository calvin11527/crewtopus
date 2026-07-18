import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnCli } from '../adapters/base';
import { getAgent } from './agent-registry';
import {
  DEFAULT_LOCAL_MODEL_ID,
  findRecommendedLocalModel,
  providerLabel,
  RECOMMENDED_LOCAL_MODELS,
  type LocalLlmTier,
  type RecommendedLocalModel,
} from './local-llm-catalog';
import type { AgentType } from '../types';

export interface AgentModelOption {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  installed?: boolean;
  recommended?: boolean;
  minRamGb?: number;
  tier?: LocalLlmTier;
}

export type AgentModelCatalog = Partial<Record<AgentType, AgentModelOption[]>>;

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

const STATIC_MODELS: Partial<Record<AgentType, AgentModelOption[]>> = {
  claude: [
    { id: 'sonnet', label: 'Claude Sonnet', description: 'Latest Sonnet alias', isDefault: true },
    { id: 'opus', label: 'Claude Opus', description: 'Highest capability' },
    { id: 'haiku', label: 'Claude Haiku', description: 'Fast and economical' },
  ],
  copilot: [
    // `auto` is the only reliably available choice across plans; named models often 404 for the account.
    { id: 'auto', label: 'Auto', description: 'Let Copilot pick an available model (recommended)', isDefault: true },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Premium (requires plan entitlement)' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini', description: 'Faster, lower cost (if entitled)' },
    { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5', description: 'If entitled on your Copilot plan' },
  ],
  mock: [{ id: 'mock', label: 'Mock', description: 'Deterministic demo responses', isDefault: true }],
  antigravity: [{ id: 'default', label: 'Default', description: 'Provider default model', isDefault: true }],
};

const TYPE_DEFAULT_ENV: Partial<Record<AgentType, string>> = {
  grok: 'GROK_DEFAULT_MODEL',
  copilot: 'COPILOT_DEFAULT_MODEL',
  claude: 'CLAUDE_DEFAULT_MODEL',
  antigravity: 'ANTIGRAVITY_DEFAULT_MODEL',
  ollama: 'OLLAMA_MODEL',
};

function grokHome(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), '.grok');
}

function readGrokModelsCache(): AgentModelOption[] {
  const cachePath = path.join(grokHome(), 'models_cache.json');
  if (!fs.existsSync(cachePath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as {
      models?: Record<string, { info?: { id?: string; name?: string; description?: string } }>;
    };
    const models = raw.models ?? {};
    const options: AgentModelOption[] = [];
    for (const entry of Object.values(models)) {
      const info = entry.info;
      if (!info?.id) continue;
      options.push({
        id: info.id,
        label: info.name || info.id,
        description: info.description,
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

async function listGrokModelsFromCli(): Promise<AgentModelOption[]> {
  try {
    const command = process.env.GROK_CLI_PATH || 'grok';
    const result = await spawnCli(command, ['models'], undefined, 15_000);
    if (result.exitCode !== 0) return [];

    let defaultId: string | undefined;
    const options: AgentModelOption[] = [];

    for (const line of result.stdout.split('\n')) {
      const defaultMatch = line.match(/Default model:\s*(\S+)/i);
      if (defaultMatch) defaultId = defaultMatch[1];

      const modelMatch = line.match(/^\s*[-*]\s+(\S+)/);
      if (!modelMatch) continue;
      const id = modelMatch[1].replace(/\s*\(default\)$/i, '');
      options.push({
        id,
        label: id,
        isDefault: line.includes('*') || id === defaultId,
      });
    }

    if (defaultId) {
      for (const option of options) {
        option.isDefault = option.id === defaultId;
      }
    }

    return options;
  } catch {
    return [];
  }
}

async function listGrokModels(): Promise<AgentModelOption[]> {
  const cached = readGrokModelsCache();
  if (cached.length > 0) {
    if (!cached.some((m) => m.isDefault)) {
      const defaultId = process.env.GROK_DEFAULT_MODEL || 'grok-composer-2.5-fast';
      for (const option of cached) {
        if (option.id === defaultId) option.isDefault = true;
      }
    }
    return cached;
  }

  const cli = await listGrokModelsFromCli();
  if (cli.length > 0) return cli;

  return [
    {
      id: 'grok-composer-2.5-fast',
      label: 'Composer 2.5 Fast',
      description: 'Grok CLI default coding model',
      isDefault: true,
    },
    { id: 'grok-build', label: 'Grok Build', description: 'xAI coding model' },
  ];
}

function isModelInstalled(installedNames: string[], modelId: string): boolean {
  const target = modelId.toLowerCase();
  return installedNames.some((name) => {
    const lower = name.toLowerCase();
    return lower === target || lower.startsWith(`${target}:`) || target.startsWith(`${lower}:`);
  });
}

function recommendedToOption(rec: RecommendedLocalModel, installedNames: string[], defaultModel: string): AgentModelOption {
  const installed = isModelInstalled(installedNames, rec.id);
  return {
    id: rec.id,
    label: rec.label,
    description: `${rec.description} (${providerLabel(rec.provider)})`,
    isDefault: rec.id === defaultModel || rec.isDefault === true,
    installed,
    recommended: true,
    minRamGb: rec.minRamGb,
    tier: rec.tier,
  };
}

function mergeOllamaCatalog(installedNames: string[]): AgentModelOption[] {
  const defaultModel = process.env.OLLAMA_MODEL || DEFAULT_LOCAL_MODEL_ID;
  const merged = new Map<string, AgentModelOption>();

  for (const rec of RECOMMENDED_LOCAL_MODELS) {
    merged.set(rec.id, recommendedToOption(rec, installedNames, defaultModel));
  }

  for (const name of installedNames) {
    if (merged.has(name)) {
      const existing = merged.get(name)!;
      merged.set(name, { ...existing, installed: true, isDefault: name === defaultModel || existing.isDefault });
      continue;
    }

    const rec = findRecommendedLocalModel(name);
    merged.set(name, {
      id: name,
      label: rec?.label ?? name,
      description: rec?.description ?? 'Installed Ollama model',
      isDefault: name === defaultModel,
      installed: true,
      recommended: Boolean(rec),
      minRamGb: rec?.minRamGb,
      tier: rec?.tier,
    });
  }

  const options = [...merged.values()];
  if (!options.some((m) => m.isDefault)) {
    const fallback =
      options.find((m) => m.id === defaultModel) ??
      options.find((m) => m.recommended && m.isDefault) ??
      options.find((m) => m.installed) ??
      options[0];
    if (fallback) fallback.isDefault = true;
  }

  return options.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

async function fetchInstalledOllamaModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { models?: Array<{ name: string }> };
  return (data.models ?? []).map((m) => m.name);
}

async function listOllamaModels(): Promise<AgentModelOption[]> {
  try {
    const installedNames = await fetchInstalledOllamaModels();
    return mergeOllamaCatalog(installedNames);
  } catch {
    const fallback = process.env.OLLAMA_MODEL || DEFAULT_LOCAL_MODEL_ID;
    return mergeOllamaCatalog([]);
  }
}

/** Curated local LLM recommendations with live install status from Ollama. */
export async function listRecommendedLocalModels(): Promise<
  Array<RecommendedLocalModel & { installed: boolean }>
> {
  let installedNames: string[] = [];
  try {
    installedNames = await fetchInstalledOllamaModels();
  } catch {
    /* Ollama offline — still return catalog */
  }

  return RECOMMENDED_LOCAL_MODELS.map((rec) => ({
    ...rec,
    installed: isModelInstalled(installedNames, rec.id),
  }));
}

/** List models available for a single agent adapter type. */
export async function listModelsForAgentType(type: AgentType): Promise<AgentModelOption[]> {
  if (type === 'grok') return listGrokModels();
  if (type === 'ollama') return listOllamaModels();
  return STATIC_MODELS[type] ?? [];
}

/** List models for all supported agent types. */
export async function listAgentModelCatalog(): Promise<AgentModelCatalog> {
  const types: AgentType[] = ['grok', 'copilot', 'claude', 'antigravity', 'ollama', 'mock'];
  const entries = await Promise.all(types.map(async (type) => [type, await listModelsForAgentType(type)] as const));
  return Object.fromEntries(entries);
}

function defaultModelForType(type: AgentType, catalog?: AgentModelOption[]): string | undefined {
  const envKey = TYPE_DEFAULT_ENV[type];
  if (envKey && process.env[envKey]) return process.env[envKey];

  const fromCatalog = catalog?.find((m) => m.isDefault)?.id ?? catalog?.[0]?.id;
  if (fromCatalog) return fromCatalog;

  if (type === 'grok') return 'grok-composer-2.5-fast';
  if (type === 'ollama') return process.env.OLLAMA_MODEL || DEFAULT_LOCAL_MODEL_ID;
  if (type === 'mock') return 'mock';
  return undefined;
}

/** Resolve the model ID for an outbound run (per-agent config overrides type default). */
export function resolveModelForAgent(
  agentId: string | undefined,
  agentType: AgentType,
  catalog?: AgentModelOption[]
): string | undefined {
  if (agentId) {
    const agent = getAgent(agentId);
    const configured = agent?.config.model;
    if (typeof configured === 'string' && configured.trim()) {
      return configured.trim();
    }
  }
  return defaultModelForType(agentType, catalog);
}

/** Validate a model id for an agent type (allows custom ids not in catalog). */
export function validateAgentModel(type: AgentType, model: unknown): string | null {
  if (model === undefined || model === null || model === '') return null;
  if (typeof model !== 'string' || !model.trim()) {
    return 'model must be a non-empty string';
  }
  if (model.length > 128) return 'model must be 128 characters or fewer';
  if (type === 'mock' || type === 'antigravity') return null;
  return null;
}