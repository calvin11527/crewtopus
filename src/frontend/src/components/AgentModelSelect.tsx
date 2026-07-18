import type { AgentModelOption, AgentType } from '../types';

interface AgentModelSelectProps {
  agentType: AgentType;
  models: AgentModelOption[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  allowCustom?: boolean;
}

export default function AgentModelSelect({
  agentType,
  models,
  value,
  onChange,
  disabled = false,
  allowCustom = true,
}: AgentModelSelectProps) {
  const hasCatalog = models.length > 0;
  const defaultId = models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? '';

  return (
    <label className="agent-model-select">
      Model
      {hasCatalog ? (
        <select
          className="input"
          value={value || defaultId}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
              {model.isDefault ? ' (default)' : ''}
              {agentType === 'ollama' && model.installed === false ? ' — not installed' : ''}
              {agentType === 'ollama' && model.minRamGb ? ` · ${model.minRamGb}GB+` : ''}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input"
          value={value}
          disabled={disabled}
          placeholder={`${agentType} model id`}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hasCatalog && allowCustom && (
        <input
          className="input"
          style={{ marginTop: 8 }}
          value={value}
          disabled={disabled}
          placeholder="Or enter a custom model id"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {models.find((m) => m.id === value)?.description && (
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>
          {models.find((m) => m.id === value)?.description}
        </span>
      )}
    </label>
  );
}