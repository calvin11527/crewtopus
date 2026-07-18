import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useAgents,
  useToggleAgent,
  useCapabilities,
  useAgentRoster,
  useAgentSkillCatalog,
  useAgentModelCatalog,
  useHireAgent,
  useUpdateEmployment,
  useUpdateAgent,
  useAgentCredits,
} from '../api/hooks';
import { useAppStore } from '../stores/useAppStore';
import AgentCard from '../components/AgentCard';
import AgentModelSelect from '../components/AgentModelSelect';
import AgentSkillPicker from '../components/AgentSkillPicker';
import Modal from '../components/Modal';
import { AGENT_ROLE_LABELS } from '../constants/agent-roles';
import { AGENT_TYPES, formatAgentType } from '../constants/agent-types';
import { Bot, ChevronDown, ChevronRight, Coins, Plus, Search, Trash2, UserPlus } from 'lucide-react';
import type { Agent, AgentRole, AgentType, RosterAgent, WorkingHoursBlock } from '../types';

const HIRE_ROLES: AgentRole[] = [
  'scrum_master',
  'project_manager',
  'business_analyst',
  'developer',
  'tester',
  'reviewer',
  'custom',
];

const DEFAULT_HOURS: WorkingHoursBlock = { dow: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };

const DAY_OPTIONS: { dow: number; label: string }[] = [
  { dow: 0, label: 'Sun' },
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' },
  { dow: 6, label: 'Sat' },
];

function cloneHours(blocks: WorkingHoursBlock[]): WorkingHoursBlock[] {
  return blocks.map((b) => ({ ...b, dow: [...b.dow] }));
}

function validateHours(blocks: WorkingHoursBlock[]): string | null {
  if (blocks.length === 0) return 'Add at least one shift block';
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.dow.length === 0) return `Block ${i + 1}: select at least one day`;
    if (!block.start || !block.end) return `Block ${i + 1}: set start and end times`;
    if (block.start >= block.end) return `Block ${i + 1}: end time must be after start`;
  }
  return null;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

export default function Agents() {
  const { data: agents, isLoading } = useAgents();
  const { data: roster } = useAgentRoster();
  const { data: capabilities } = useCapabilities();
  const { data: skillCatalog } = useAgentSkillCatalog();
  const { data: modelCatalog } = useAgentModelCatalog();
  const { data: credits } = useAgentCredits();
  const toggle = useToggleAgent();
  const hire = useHireAgent();
  const updateEmployment = useUpdateEmployment();
  const updateAgent = useUpdateAgent();
  const agentStatuses = useAppStore((s) => s.agentStatuses);

  const [hireOpen, setHireOpen] = useState(false);
  const [hireError, setHireError] = useState<string | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(true);
  const [editingAgent, setEditingAgent] = useState<RosterAgent | null>(null);
  const [configuringAgent, setConfiguringAgent] = useState<Agent | null>(null);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [typeDraft, setTypeDraft] = useState<AgentType>('grok');
  const [nameDraft, setNameDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [creditLimitDraft, setCreditLimitDraft] = useState('');
  const [tokenQuotaDraft, setTokenQuotaDraft] = useState('');
  const [clearTokenQuota, setClearTokenQuota] = useState(false);
  const [showLimits, setShowLimits] = useState(false);
  const [confirmTypeSwitch, setConfirmTypeSwitch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<AgentType | 'all'>('all');

  const [form, setForm] = useState({
    name: '',
    type: 'grok' as AgentType,
    role: 'developer' as AgentRole,
    customRoleLabel: '',
    profileDescription: '',
    skills: [] as string[],
    model: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });

  const [hoursForm, setHoursForm] = useState({
    timezone: 'UTC',
    blocks: [DEFAULT_HOURS] as WorkingHoursBlock[],
  });

  const defaultSkillsForRole = useCallback(
    (role: AgentRole) => {
      if (!skillCatalog) return [];
      return skillCatalog.filter((s) => s.suggestedRoles.includes(role)).map((s) => s.id);
    },
    [skillCatalog]
  );

  useEffect(() => {
    if (!skillCatalog || form.role === 'custom') return;
    setForm((f) => ({ ...f, skills: defaultSkillsForRole(f.role) }));
  }, [form.role, skillCatalog, defaultSkillsForRole]);

  useEffect(() => {
    const models = modelCatalog?.[form.type] ?? [];
    const defaultModel = models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? '';
    setForm((f) => ({ ...f, model: defaultModel }));
  }, [form.type, modelCatalog]);

  /** Prefer roster rows (employment + sprints); fall back to bare agents. */
  const allDisplayAgents = useMemo((): RosterAgent[] => {
    if (roster && roster.length > 0) {
      return roster.map((r) => ({
        ...r,
        status: (agentStatuses[r.id] || r.status) as Agent['status'],
      }));
    }
    return (agents ?? []).map((a) => ({
      ...a,
      status: (agentStatuses[a.id] || a.status) as Agent['status'],
      onShift: false,
      sprintAssignments: [],
    }));
  }, [roster, agents, agentStatuses]);

  const overBudgetTypes = useMemo(
    () => new Set((credits ?? []).filter((c) => c.overBudget).map((c) => c.agentType)),
    [credits]
  );

  const displayAgents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allDisplayAgents.filter((agent) => {
      if (typeFilter !== 'all' && agent.type !== typeFilter) return false;
      if (!q) return true;
      const title = (agent.employment?.displayTitle ?? agent.name).toLowerCase();
      const role =
        agent.employment?.role === 'custom'
          ? (agent.employment.customRoleLabel ?? 'custom').toLowerCase()
          : (agent.employment?.role ?? '').replace(/_/g, ' ');
      const model =
        typeof agent.config?.model === 'string' ? agent.config.model.toLowerCase() : '';
      const sprints = (agent.sprintAssignments ?? [])
        .map((s) => s.sprintName)
        .join(' ')
        .toLowerCase();
      return (
        title.includes(q) ||
        agent.name.toLowerCase().includes(q) ||
        agent.type.includes(q) ||
        formatAgentType(agent.type).toLowerCase().includes(q) ||
        role.includes(q) ||
        model.includes(q) ||
        sprints.includes(q)
      );
    });
  }, [allDisplayAgents, searchQuery, typeFilter]);

  const resetHireForm = () => {
    setForm({
      name: '',
      type: 'grok',
      role: 'developer',
      customRoleLabel: '',
      profileDescription: '',
      skills: skillCatalog ? defaultSkillsForRole('developer') : [],
      model: modelCatalog?.grok?.find((m) => m.isDefault)?.id ?? modelCatalog?.grok?.[0]?.id ?? '',
      timezone: form.timezone,
    });
    setHireError(null);
  };

  const handleHire = async () => {
    if (!form.name.trim()) return;
    if (form.role === 'custom' && !form.customRoleLabel.trim()) {
      setHireError('Enter a custom role title (e.g. Security Architect).');
      return;
    }
    if (form.skills.length === 0) {
      setHireError('Select at least one elite skill for this agent.');
      return;
    }
    setHireError(null);
    try {
      await hire.mutateAsync({
        name: form.name.trim(),
        type: form.type,
        role: form.role,
        customRoleLabel: form.role === 'custom' ? form.customRoleLabel.trim() : undefined,
        profileDescription: form.profileDescription.trim() || undefined,
        skills: form.skills,
        timezone: form.timezone,
        workingHours: [DEFAULT_HOURS],
        config: form.model ? { model: form.model } : undefined,
      });
      setHireOpen(false);
      resetHireForm();
    } catch (err) {
      setHireError(err instanceof Error ? err.message : 'Failed to hire agent');
    }
  };

  const openEditHours = (agent: RosterAgent) => {
    const employment = agent.employment;
    if (!employment) return;
    setEditingAgent(agent);
    setHoursError(null);
    setHoursForm({
      timezone: employment.timezone || 'UTC',
      blocks: cloneHours(
        employment.workingHours.length > 0 ? employment.workingHours : [DEFAULT_HOURS]
      ),
    });
    setHoursOpen(true);
  };

  const closeEditHours = () => {
    setHoursOpen(false);
    setEditingAgent(null);
    setHoursError(null);
  };

  const toggleDay = (blockIndex: number, dow: number) => {
    setHoursForm((f) => ({
      ...f,
      blocks: f.blocks.map((block, i) => {
        if (i !== blockIndex) return block;
        const has = block.dow.includes(dow);
        const nextDow = has ? block.dow.filter((d) => d !== dow) : [...block.dow, dow].sort((a, b) => a - b);
        return { ...block, dow: nextDow };
      }),
    }));
  };

  const updateBlock = (blockIndex: number, patch: Partial<WorkingHoursBlock>) => {
    setHoursForm((f) => ({
      ...f,
      blocks: f.blocks.map((block, i) => (i === blockIndex ? { ...block, ...patch } : block)),
    }));
  };

  const addBlock = () => {
    setHoursForm((f) => ({
      ...f,
      blocks: [...f.blocks, { dow: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }],
    }));
  };

  const removeBlock = (blockIndex: number) => {
    setHoursForm((f) => ({
      ...f,
      blocks: f.blocks.length <= 1 ? f.blocks : f.blocks.filter((_, i) => i !== blockIndex),
    }));
  };

  const openConfigureAgent = (agent: Agent) => {
    const models = modelCatalog?.[agent.type] ?? [];
    const configured = typeof agent.config.model === 'string' ? agent.config.model : '';
    const defaultModel = models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? '';
    const creditLimit =
      typeof agent.config.creditLimit === 'number' ? agent.config.creditLimit : undefined;
    const tokenQuota =
      typeof agent.config.monthlyTokenQuota === 'number' ? agent.config.monthlyTokenQuota : undefined;
    setConfiguringAgent(agent);
    setTypeDraft(agent.type);
    setNameDraft(agent.name);
    setModelDraft(configured || defaultModel);
    setCreditLimitDraft(creditLimit !== undefined ? String(creditLimit) : '');
    setTokenQuotaDraft(tokenQuota !== undefined ? String(tokenQuota) : '');
    setClearTokenQuota(false);
    setShowLimits(false);
    setConfirmTypeSwitch(false);
    setConfigError(null);
    setConfigOpen(true);
  };

  const openConfigureById = (agentId: string) => {
    const agent = agents?.find((a) => a.id === agentId) ?? roster?.find((a) => a.id === agentId);
    if (agent) openConfigureAgent(agent);
  };

  const closeConfigure = () => {
    setConfigOpen(false);
    setConfiguringAgent(null);
    setConfigError(null);
  };

  const onTypeDraftChange = (nextType: AgentType) => {
    setTypeDraft(nextType);
    const models = modelCatalog?.[nextType] ?? [];
    const defaultModel = models.find((m) => m.isDefault)?.id ?? models[0]?.id ?? '';
    setModelDraft(defaultModel);
    setConfirmTypeSwitch(false);
  };

  const configuringLiveStatus =
    configuringAgent
      ? agentStatuses[configuringAgent.id] || configuringAgent.status
      : 'idle';
  const configuringIsRunning = configuringLiveStatus === 'running';

  const handleSaveConfigure = async () => {
    if (!configuringAgent) return;
    if (!nameDraft.trim()) {
      setConfigError('Name is required.');
      return;
    }
    if (configuringIsRunning && typeDraft !== configuringAgent.type) {
      setConfigError('Cannot change adapter while this agent is running.');
      return;
    }
    if (typeDraft !== configuringAgent.type && !confirmTypeSwitch) {
      setConfigError(
        `Confirm switching adapter from ${formatAgentType(configuringAgent.type)} to ${formatAgentType(typeDraft)}.`
      );
      return;
    }

    const config: Record<string, unknown> = {};
    if (modelDraft.trim()) config.model = modelDraft.trim();

    if (showLimits) {
      const creditRaw = creditLimitDraft.trim();
      if (creditRaw !== '') {
        const creditLimit = Number(creditRaw);
        if (!Number.isFinite(creditLimit) || creditLimit < 0) {
          setConfigError('Credit limit must be a non-negative number (0 = unlimited).');
          return;
        }
        config.creditLimit = creditLimit;
      }
      if (clearTokenQuota) {
        config.monthlyTokenQuota = null;
      } else if (tokenQuotaDraft.trim() !== '') {
        const quota = Number(tokenQuotaDraft.trim());
        if (!Number.isFinite(quota) || quota <= 0) {
          setConfigError('Monthly token quota must be a positive number, or clear it.');
          return;
        }
        config.monthlyTokenQuota = Math.round(quota);
      }
    }

    setConfigError(null);
    try {
      await updateAgent.mutateAsync({
        id: configuringAgent.id,
        type: typeDraft,
        name: nameDraft.trim(),
        config,
      });
      closeConfigure();
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to save agent');
    }
  };

  const handleSaveHours = async () => {
    if (!editingAgent) return;
    const validationError = validateHours(hoursForm.blocks);
    if (validationError) {
      setHoursError(validationError);
      return;
    }
    setHoursError(null);
    try {
      await updateEmployment.mutateAsync({
        id: editingAgent.id,
        timezone: hoursForm.timezone.trim() || 'UTC',
        workingHours: cloneHours(hoursForm.blocks),
      });
      closeEditHours();
    } catch (err) {
      setHoursError(err instanceof Error ? err.message : 'Failed to save working hours');
    }
  };

  const typeChanged =
    configuringAgent !== null && typeDraft !== configuringAgent.type;

  return (
    <div id="page-agents" className="page page--agents">
      <header className="page-header page-header--row">
        <div>
          <h2>Agent Registry</h2>
          <p className="page-subtitle">
            Manage who runs work — switch adapters (Copilot ↔ Grok), models, and staffing
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            resetHireForm();
            setHireOpen(true);
          }}
        >
          <UserPlus size={16} /> Hire agent
        </button>
      </header>

      {/* Compact usage strip */}
      <section className="agents-usage card">
        <button
          type="button"
          className="agents-section-toggle"
          onClick={() => setUsageOpen((o) => !o)}
          aria-expanded={usageOpen}
        >
          <span className="agents-section-toggle__label">
            <Coins size={16} />
            Provider usage
            {overBudgetTypes.size > 0 && (
              <span className="tag tag--danger">{overBudgetTypes.size} over quota</span>
            )}
          </span>
          {usageOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {usageOpen && (
          <div className="agents-usage-grid">
            {(credits ?? []).length === 0 ? (
              <p className="text-muted">No usage data yet.</p>
            ) : (
              (credits ?? []).map((entry) => (
                <button
                  key={entry.agentType}
                  type="button"
                  className={`agents-usage-chip${entry.overBudget ? ' agents-usage-chip--critical' : ''}`}
                  onClick={() => openConfigureById(entry.agentId)}
                  title="Open adapter settings for an agent of this type"
                >
                  <strong>{formatAgentType(entry.agentType)}</strong>
                  <span>
                    {entry.unlimited
                      ? 'Unlimited'
                      : entry.overBudget
                        ? `${entry.percentageUsed}%+ over`
                        : `${entry.percentageUsed}% used`}
                  </span>
                  {(entry.providerTokenCount ?? entry.tokenCount) > 0 && (
                    <span className="text-muted">
                      {formatTokens(entry.providerTokenCount ?? entry.tokenCount)} tok
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
        {overBudgetTypes.size > 0 && usageOpen && (
          <p className="agents-usage-hint text-muted">
            Over quota blocks that adapter. Click a chip → change <strong>Adapter</strong> (e.g.
            Copilot → Grok) so the role can keep working on a different provider.
          </p>
        )}
      </section>

      {isLoading ? (
        <p className="loading-text">Loading agents...</p>
      ) : (
        <>
          <section className="agents-list-section">
            <div className="agents-list-header">
              <h3>
                <Bot size={18} /> Agents
                <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
                  {displayAgents.length}
                  {displayAgents.length !== allDisplayAgents.length
                    ? ` / ${allDisplayAgents.length}`
                    : ''}
                </span>
              </h3>
              <div className="agents-toolbar">
                <label className="agents-search">
                  <Search size={14} />
                  <input
                    className="input"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search name, role, model…"
                    aria-label="Search agents"
                  />
                </label>
                <div className="agents-type-filters" role="group" aria-label="Filter by adapter">
                  <button
                    type="button"
                    className={`agents-type-filter${typeFilter === 'all' ? ' agents-type-filter--active' : ''}`}
                    onClick={() => setTypeFilter('all')}
                  >
                    All
                  </button>
                  {AGENT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`agents-type-filter${typeFilter === t ? ' agents-type-filter--active' : ''}${overBudgetTypes.has(t) ? ' agents-type-filter--warn' : ''}`}
                      onClick={() => setTypeFilter(t)}
                    >
                      {formatAgentType(t)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {allDisplayAgents.length === 0 ? (
              <div className="card agents-empty">
                <p>No agents yet. Hire one to staff sprint roles.</p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    resetHireForm();
                    setHireOpen(true);
                  }}
                >
                  <UserPlus size={16} /> Hire agent
                </button>
              </div>
            ) : displayAgents.length === 0 ? (
              <div className="card agents-empty">
                <p>No agents match this search/filter.</p>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setSearchQuery('');
                    setTypeFilter('all');
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div id="agent-grid" className="agent-grid">
                {displayAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    models={modelCatalog?.[agent.type]}
                    liveStatus={agentStatuses[agent.id] || agent.status}
                    overBudget={overBudgetTypes.has(agent.type)}
                    onToggle={(id, enable) => toggle.mutate({ id, enable })}
                    onConfigure={openConfigureAgent}
                    onEditHours={openEditHours}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="card agents-caps">
            <button
              type="button"
              className="agents-section-toggle"
              onClick={() => setCapsOpen((o) => !o)}
              aria-expanded={capsOpen}
            >
              <span className="agents-section-toggle__label">
                <Bot size={16} /> Capability map
              </span>
              {capsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {capsOpen && (
              <div className="capability-grid">
                {Object.entries(
                  (capabilities || []).reduce(
                    (acc, cap) => {
                      const agent = agents?.find((a) => a.id === cap.agentId);
                      const type = agent?.type || 'unknown';
                      if (!acc[type]) acc[type] = [];
                      if (!acc[type].includes(cap.name)) acc[type].push(cap.name);
                      return acc;
                    },
                    {} as Record<string, string[]>
                  )
                ).map(([type, caps]) => (
                  <div key={type} id={`capability-${type}`} className="capability-group">
                    <strong>{formatAgentType(type)}</strong>
                    <div className="capability-tags">
                      {caps.map((c) => (
                        <span key={c} className="tag">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Working hours modal */}
      <Modal
        id="modal-edit-hours"
        open={hoursOpen}
        title={
          editingAgent
            ? `Working hours — ${editingAgent.employment?.displayTitle ?? editingAgent.name}`
            : 'Working hours'
        }
        onClose={closeEditHours}
      >
        <div className="form-stack">
          <label>
            Timezone
            <input
              className="input"
              value={hoursForm.timezone}
              onChange={(e) => setHoursForm((f) => ({ ...f, timezone: e.target.value }))}
              placeholder="e.g. America/Los_Angeles"
            />
          </label>

          {hoursForm.blocks.map((block, blockIndex) => (
            <div key={blockIndex} className="card" style={{ padding: 12 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <strong>Shift block {blockIndex + 1}</strong>
                {hoursForm.blocks.length > 1 && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => removeBlock(blockIndex)}
                    title="Remove block"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <div
                className="dow-picker"
                style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}
              >
                {DAY_OPTIONS.map(({ dow, label }) => (
                  <label
                    key={dow}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={block.dow.includes(dow)}
                      onChange={() => toggleDay(blockIndex, dow)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ flex: 1 }}>
                  Start
                  <input
                    className="input"
                    type="time"
                    value={block.start}
                    onChange={(e) => updateBlock(blockIndex, { start: e.target.value })}
                  />
                </label>
                <label style={{ flex: 1 }}>
                  End
                  <input
                    className="input"
                    type="time"
                    value={block.end}
                    onChange={(e) => updateBlock(blockIndex, { end: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}

          <button type="button" className="btn btn--ghost btn--sm" onClick={addBlock}>
            <Plus size={14} /> Add shift block
          </button>

          {hoursError && <p className="form-error">{hoursError}</p>}

          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={closeEditHours}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSaveHours}
              disabled={updateEmployment.isPending}
            >
              Save hours
            </button>
          </div>
        </div>
      </Modal>

      {/* Configure adapter + model */}
      <Modal
        id="modal-agent-configure"
        open={configOpen}
        title={configuringAgent ? `Configure — ${configuringAgent.name}` : 'Configure agent'}
        onClose={closeConfigure}
      >
        {configuringAgent && (
          <div className="form-stack agent-configure-form">
            <div className="agent-configure-section">
              <h4 className="agent-configure-section__title">Identity</h4>
              <label>
                Display name
                <input
                  className="input"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </label>
            </div>

            <div className="agent-configure-section">
              <h4 className="agent-configure-section__title">Adapter</h4>
              <p className="text-muted agent-configure-help">
                Switch the CLI/provider this agent uses for BA, PM, and developer work. Sprint
                staffing stays on the same agent — only the backend adapter changes.
              </p>
              {configuringIsRunning && (
                <p className="form-error" style={{ margin: 0 }}>
                  This agent is running. Wait for the job to finish before changing adapter.
                </p>
              )}
              <label>
                Provider
                <select
                  className="input"
                  value={typeDraft}
                  disabled={configuringIsRunning}
                  onChange={(e) => onTypeDraftChange(e.target.value as AgentType)}
                >
                  {AGENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {formatAgentType(t)}
                      {overBudgetTypes.has(t) ? ' (over quota)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {typeChanged && (
                <>
                  <p className="agent-configure-type-change">
                    Switching <strong>{formatAgentType(configuringAgent.type)}</strong> →{' '}
                    <strong>{formatAgentType(typeDraft)}</strong>. Sprint roles keep this agent;
                    runs use the new provider. Previous provider calibration is cleared.
                  </p>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={confirmTypeSwitch}
                      onChange={(e) => setConfirmTypeSwitch(e.target.checked)}
                    />
                    Confirm switch to {formatAgentType(typeDraft)}
                  </label>
                </>
              )}
            </div>

            <div className="agent-configure-section">
              <h4 className="agent-configure-section__title">Model</h4>
              <AgentModelSelect
                agentType={typeDraft}
                models={modelCatalog?.[typeDraft] ?? []}
                value={modelDraft}
                onChange={setModelDraft}
              />
            </div>

            <div className="agent-configure-section">
              <button
                type="button"
                className="agents-section-toggle agents-section-toggle--subtle"
                onClick={() => setShowLimits((o) => !o)}
              >
                <span>Usage limits (optional)</span>
                {showLimits ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {showLimits && (
                <>
                  <label>
                    Credit limit (0 = unlimited)
                    <input
                      className="input"
                      type="number"
                      min={0}
                      step={100}
                      value={creditLimitDraft}
                      placeholder="Leave blank to keep current"
                      onChange={(e) => setCreditLimitDraft(e.target.value)}
                    />
                  </label>
                  <label>
                    Monthly token quota
                    <input
                      className="input"
                      type="number"
                      min={1}
                      step={1000}
                      value={tokenQuotaDraft}
                      disabled={clearTokenQuota}
                      placeholder="Leave blank to keep current"
                      onChange={(e) => setTokenQuotaDraft(e.target.value)}
                    />
                  </label>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={clearTokenQuota}
                      onChange={(e) => setClearTokenQuota(e.target.checked)}
                    />
                    Clear monthly token quota
                  </label>
                </>
              )}
            </div>

            {configError && <p className="form-error">{configError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={closeConfigure}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSaveConfigure}
                disabled={
                  updateAgent.isPending ||
                  (typeChanged && configuringIsRunning) ||
                  (typeChanged && !confirmTypeSwitch)
                }
              >
                {typeChanged
                  ? `Switch to ${formatAgentType(typeDraft)}`
                  : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        id="modal-hire-agent"
        open={hireOpen}
        title="Hire agent"
        onClose={() => {
          setHireOpen(false);
          setHireError(null);
        }}
      >
        <div className="form-stack hire-agent-form">
          <label>
            Display name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Grok Developer"
            />
          </label>
          <label>
            Adapter
            <select
              className="input"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AgentType }))}
            >
              {AGENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatAgentType(t)}
                </option>
              ))}
            </select>
          </label>
          <AgentModelSelect
            agentType={form.type}
            models={modelCatalog?.[form.type] ?? []}
            value={form.model}
            onChange={(model) => setForm((f) => ({ ...f, model }))}
          />
          <label>
            Role template
            <select
              className="input"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AgentRole }))}
            >
              {HIRE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {AGENT_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </label>
          {form.role === 'custom' && (
            <label>
              Custom role title
              <input
                className="input"
                value={form.customRoleLabel}
                onChange={(e) => setForm((f) => ({ ...f, customRoleLabel: e.target.value }))}
                placeholder="e.g. Security Architect, DevOps Lead"
              />
            </label>
          )}
          <label>
            Profile description
            <textarea
              className="input"
              rows={3}
              value={form.profileDescription}
              onChange={(e) => setForm((f) => ({ ...f, profileDescription: e.target.value }))}
              placeholder="What this agent owns and when to engage it."
            />
          </label>
          {skillCatalog && skillCatalog.length > 0 ? (
            <AgentSkillPicker
              catalog={skillCatalog}
              selected={form.skills}
              role={form.role}
              onChange={(skills) => setForm((f) => ({ ...f, skills }))}
            />
          ) : (
            <p className="text-muted">Loading skill catalog…</p>
          )}
          <label>
            Timezone
            <input
              className="input"
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            />
          </label>
          <p className="text-muted">Default hours: Mon–Fri 09:00–17:00 ({form.timezone})</p>
          {hireError && <p className="form-error">{hireError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setHireOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleHire}
              disabled={hire.isPending || !form.name.trim()}
            >
              Hire
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
