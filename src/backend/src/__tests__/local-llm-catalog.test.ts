import {
  DEFAULT_LOCAL_MODEL_ID,
  findRecommendedLocalModel,
  modelsForRamGb,
  modelsForTier,
  RECOMMENDED_LOCAL_MODELS,
} from '../modules/local-llm-catalog';

describe('local-llm-catalog', () => {
  it('defaults to Gemma 4 MLX on Apple Silicon', () => {
    expect(DEFAULT_LOCAL_MODEL_ID).toBe('gemma4:26b-mlx');
    const defaults = RECOMMENDED_LOCAL_MODELS.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].provider).toBe('google');
  });

  it('excludes China-based providers from the catalog', () => {
    const ids = RECOMMENDED_LOCAL_MODELS.map((m) => m.id).join(' ');
    expect(ids).not.toMatch(/qwen|deepseek/i);
  });

  it('finds recommendations by exact or partial tag', () => {
    expect(findRecommendedLocalModel('gemma4:26b-mlx')?.provider).toBe('google');
    expect(findRecommendedLocalModel('codestral:22b')?.provider).toBe('mistral');
    expect(findRecommendedLocalModel('gemma4:26b')?.id).toBe('gemma4:26b-mlx');
  });

  it('groups models by tier', () => {
    const quality = modelsForTier('quality');
    expect(quality.every((m) => m.tier === 'quality')).toBe(true);
    expect(quality.some((m) => m.id === 'gemma4:26b-mlx')).toBe(true);
  });

  it('suggests pro-tier models for 48GB machines', () => {
    const fits = modelsForRamGb(48);
    expect(fits.some((m) => m.id === 'gemma4:26b-mlx')).toBe(true);
    expect(fits.some((m) => m.id === 'codestral:22b')).toBe(true);
  });
});