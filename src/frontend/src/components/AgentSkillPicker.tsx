import type { AgentRole, AgentSkillDefinition } from '../types';

interface AgentSkillPickerProps {
  catalog: AgentSkillDefinition[];
  selected: string[];
  role: AgentRole;
  onChange: (skills: string[]) => void;
}

function groupByDomain(catalog: AgentSkillDefinition[]): Record<string, AgentSkillDefinition[]> {
  return catalog.reduce(
    (acc, skill) => {
      if (!acc[skill.domain]) acc[skill.domain] = [];
      acc[skill.domain].push(skill);
      return acc;
    },
    {} as Record<string, AgentSkillDefinition[]>
  );
}

export default function AgentSkillPicker({ catalog, selected, role, onChange }: AgentSkillPickerProps) {
  const grouped = groupByDomain(catalog);
  const suggested = new Set(catalog.filter((s) => s.suggestedRoles.includes(role)).map((s) => s.id));

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="skill-picker">
      <div className="skill-picker-header">
        <strong>Elite skills</strong>
        <span className="text-muted">{selected.length} selected</span>
      </div>
      <p className="text-muted skill-picker-hint">
        Pick top-tier capabilities for this agent. Suggested skills for the role are highlighted.
      </p>
      {Object.entries(grouped).map(([domain, skills]) => (
        <div key={domain} className="skill-picker-group">
          <h4 className="skill-picker-domain">{domain}</h4>
          <div className="skill-picker-grid">
            {skills.map((skill) => {
              const isSelected = selected.includes(skill.id);
              const isSuggested = suggested.has(skill.id);
              return (
                <label
                  key={skill.id}
                  className={`skill-chip${isSelected ? ' skill-chip--selected' : ''}${isSuggested ? ' skill-chip--suggested' : ''}`}
                  title={skill.description}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(skill.id)}
                  />
                  <span>{skill.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}