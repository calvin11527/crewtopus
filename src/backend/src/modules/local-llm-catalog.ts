/** Tier reflects RAM/VRAM needs and relative inference speed. */
export type LocalLlmTier = 'lightweight' | 'balanced' | 'quality';

/** Primary use case for routing and UI grouping. */
export type LocalLlmUseCase = 'coding' | 'general' | 'reasoning';

/** Model vendor region — catalog excludes China-based providers. */
export type LocalLlmProvider = 'meta' | 'mistral' | 'microsoft' | 'google' | 'ibm' | 'bigcode';

export interface RecommendedLocalModel {
  id: string;
  label: string;
  description: string;
  provider: LocalLlmProvider;
  tier: LocalLlmTier;
  useCase: LocalLlmUseCase;
  /** Minimum unified memory (GB) for comfortable inference on Apple Silicon / 8GB+ GPUs. */
  minRamGb: number;
  isDefault?: boolean;
}

const PROVIDER_LABELS: Record<LocalLlmProvider, string> = {
  meta: 'Meta (US)',
  mistral: 'Mistral (France)',
  microsoft: 'Microsoft (US)',
  google: 'Google (US)',
  ibm: 'IBM (US)',
  bigcode: 'BigCode (open)',
};

/** Curated Ollama models — Western/open providers only, no China-based LLMs. */
export const RECOMMENDED_LOCAL_MODELS: RecommendedLocalModel[] = [
  {
    id: 'llama3.2:3b',
    label: 'Llama 3.2 3B',
    description: 'Lightweight Meta model for summaries and simple tasks on 8GB machines.',
    provider: 'meta',
    tier: 'lightweight',
    useCase: 'general',
    minRamGb: 4,
  },
  {
    id: 'gemma4:e4b',
    label: 'Gemma 4 E4B',
    description: 'Google edge model for fast local tasks with vision and 128K context.',
    provider: 'google',
    tier: 'lightweight',
    useCase: 'general',
    minRamGb: 8,
  },
  {
    id: 'phi3:3.8b',
    label: 'Phi-3 3.8B',
    description: 'Fast Microsoft model with strong instruction following for quick jobs.',
    provider: 'microsoft',
    tier: 'lightweight',
    useCase: 'general',
    minRamGb: 4,
  },
  {
    id: 'llama3.1:8b',
    label: 'Llama 3.1 8B',
    description: 'Reliable general-purpose model. Good coding, planning, and chat on 8GB+ RAM.',
    provider: 'meta',
    tier: 'balanced',
    useCase: 'general',
    minRamGb: 8,
  },
  {
    id: 'gemma4:12b-mlx',
    label: 'Gemma 4 12B MLX',
    description: 'Compact Gemma 4 with 256K context. MLX-optimized for Apple Silicon.',
    provider: 'google',
    tier: 'balanced',
    useCase: 'general',
    minRamGb: 12,
  },
  {
    id: 'mistral:7b',
    label: 'Mistral 7B',
    description: 'French open model with crisp instruction following and low latency.',
    provider: 'mistral',
    tier: 'balanced',
    useCase: 'general',
    minRamGb: 8,
  },
  {
    id: 'mistral-nemo:12b',
    label: 'Mistral Nemo 12B',
    description: 'Mistral + NVIDIA collaboration. Strong balance of speed and code quality.',
    provider: 'mistral',
    tier: 'balanced',
    useCase: 'coding',
    minRamGb: 10,
  },
  {
    id: 'codellama:13b',
    label: 'Code Llama 13B',
    description: 'Meta code specialist. Solid for implementation, tests, and refactors.',
    provider: 'meta',
    tier: 'balanced',
    useCase: 'coding',
    minRamGb: 10,
  },
  {
    id: 'granite-code:8b',
    label: 'Granite Code 8B',
    description: 'IBM enterprise-leaning code model. Good for structured, conservative output.',
    provider: 'ibm',
    tier: 'balanced',
    useCase: 'coding',
    minRamGb: 8,
  },
  {
    id: 'starcoder2:15b',
    label: 'StarCoder2 15B',
    description: 'BigCode open coding model. Strong multi-language completion.',
    provider: 'bigcode',
    tier: 'balanced',
    useCase: 'coding',
    minRamGb: 12,
  },
  {
    id: 'gemma4:26b-mlx',
    label: 'Gemma 4 26B MLX',
    description:
      'Default AgentHub local model. MoE Gemma 4 with coding, reasoning, vision, and 256K context on Apple Silicon.',
    provider: 'google',
    tier: 'quality',
    useCase: 'reasoning',
    minRamGb: 20,
    isDefault: true,
  },
  {
    id: 'gemma4:31b-mlx',
    label: 'Gemma 4 31B MLX',
    description: 'Dense Gemma 4 flagship. Highest Google local quality on 32GB+ Macs.',
    provider: 'google',
    tier: 'quality',
    useCase: 'reasoning',
    minRamGb: 24,
  },
  {
    id: 'codestral:22b',
    label: 'Codestral 22B',
    description: 'Mistral code flagship. Dedicated coding model for 24GB+ Macs.',
    provider: 'mistral',
    tier: 'quality',
    useCase: 'coding',
    minRamGb: 24,
  },
  {
    id: 'devstral:24b',
    label: 'Devstral 24B',
    description: 'Mistral agentic coding model. Strong for multi-step repo tasks.',
    provider: 'mistral',
    tier: 'quality',
    useCase: 'coding',
    minRamGb: 24,
  },
  {
    id: 'codellama:34b',
    label: 'Code Llama 34B',
    description: 'Meta large code model. High-quality implementation and review on 32GB+ RAM.',
    provider: 'meta',
    tier: 'quality',
    useCase: 'coding',
    minRamGb: 24,
  },
  {
    id: 'phi4-reasoning:14b',
    label: 'Phi-4 Reasoning 14B',
    description: 'Microsoft reasoning model. Good for evaluation loops and structured verdicts.',
    provider: 'microsoft',
    tier: 'quality',
    useCase: 'reasoning',
    minRamGb: 16,
  },
  {
    id: 'granite-code:20b',
    label: 'Granite Code 20B',
    description: 'IBM larger code model for architecture-sensitive and compliance-heavy work.',
    provider: 'ibm',
    tier: 'quality',
    useCase: 'coding',
    minRamGb: 20,
  },
  {
    id: 'llama3.3:70b',
    label: 'Llama 3.3 70B',
    description: 'Meta frontier open model. Fits 48GB Macs at Q4; slower but highest general quality.',
    provider: 'meta',
    tier: 'quality',
    useCase: 'reasoning',
    minRamGb: 40,
  },
];

/** Default Ollama model tag for new installs. */
export const DEFAULT_LOCAL_MODEL_ID = 'gemma4:26b-mlx';

/** Human-readable provider label for UI. */
export function providerLabel(provider: LocalLlmProvider): string {
  return PROVIDER_LABELS[provider];
}

/** Look up a curated recommendation by Ollama model id (supports partial tag match). */
export function findRecommendedLocalModel(modelId: string): RecommendedLocalModel | undefined {
  const normalized = modelId.trim().toLowerCase();
  return RECOMMENDED_LOCAL_MODELS.find((m) => {
    const id = m.id.toLowerCase();
    return (
      normalized === id ||
      normalized.startsWith(`${id}:`) ||
      id.startsWith(`${normalized}:`) ||
      id.startsWith(normalized)
    );
  });
}

/** Models to pull for a given hardware tier. */
export function modelsForTier(tier: LocalLlmTier): RecommendedLocalModel[] {
  return RECOMMENDED_LOCAL_MODELS.filter((m) => m.tier === tier);
}

/** Best-fit models for a machine with the given unified memory (GB). Excludes China-based providers. */
export function modelsForRamGb(ramGb: number): RecommendedLocalModel[] {
  const fits = RECOMMENDED_LOCAL_MODELS.filter((m) => m.minRamGb <= ramGb);
  if (ramGb >= 40) {
    return fits.sort((a, b) => b.minRamGb - a.minRamGb);
  }
  return fits.filter((m) => m.tier !== 'quality' || m.minRamGb <= ramGb - 8);
}