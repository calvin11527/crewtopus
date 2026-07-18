import { useState } from 'react';
import { GitBranch, Play, Plus, ChevronRight } from 'lucide-react';
import { useWorkflows, useCreateWorkflow, useExecuteWorkflow } from '../api/hooks';
import { useAppStore } from '../stores/useAppStore';
import type { AgentType, WorkflowStep } from '../types';
import Modal from '../components/Modal';
import StatusBadge from '../components/StatusBadge';
import CodeEditor from '../components/CodeEditor';
import TerminalOutput from '../components/TerminalOutput';

const AGENT_TYPES: AgentType[] = ['mock', 'claude', 'grok', 'copilot', 'antigravity', 'ollama'];

export default function Workflows() {
  const { data: workflows, isLoading } = useWorkflows();
  const createWf = useCreateWorkflow();
  const executeWf = useExecuteWorkflow();
  const terminalOutput = useAppStore((s) => s.terminalOutput);
  const selectedCode = useAppStore((s) => s.selectedCode);
  const setSelectedCode = useAppStore((s) => s.setSelectedCode);

  const [modalOpen, setModalOpen] = useState(false);
  const [wfName, setWfName] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { name: 'planning', agent: 'mock', capability: 'planning' },
    { name: 'implementation', agent: 'mock', capability: 'implementation' },
    { name: 'review', agent: 'mock', capability: 'review' },
  ]);

  const addStep = () => setSteps([...steps, { name: 'step', agent: 'mock' }]);
  const updateStep = (i: number, field: keyof WorkflowStep, value: string) => {
    const next = [...steps];
    next[i] = { ...next[i], [field]: value };
    setSteps(next);
  };

  const handleCreate = async () => {
    if (!wfName.trim()) return;
    await createWf.mutateAsync({
      name: wfName,
      definition: { name: wfName, steps },
    });
    setWfName('');
    setModalOpen(false);
  };

  const handleExecute = async (id: string) => {
    setSelectedCode('// Executing workflow...\n');
    const result = await executeWf.mutateAsync({ id });
    if (result.result) setSelectedCode(result.result);
  };

  return (
    <div id="page-workflows" className="page page--wide">
      <header className="page-header page-header--row">
        <div>
          <h2>Workflow Designer</h2>
          <p className="page-subtitle">Create and execute multi-agent workflows</p>
        </div>
        <button id="btn-create-workflow" type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          <Plus size={16} /> Create Workflow
        </button>
      </header>

      {isLoading ? (
        <p className="loading-text">Loading workflows...</p>
      ) : workflows?.length === 0 ? (
        <div className="card empty-state">
          <GitBranch size={40} className="empty-icon" />
          <p>No workflows defined. Design your first multi-agent pipeline.</p>
        </div>
      ) : (
        <div className="workflow-layout">
          <div className="workflow-list">
            {workflows?.map((wf) => (
              <div key={wf.id} id={`workflow-${wf.id}`} className="card workflow-card">
                <div className="workflow-card-header">
                  <h4>{wf.name}</h4>
                  <StatusBadge status={wf.status} id={`workflow-status-${wf.id}`} />
                </div>
                <div className="workflow-steps-preview">
                  {wf.definition.steps.map((step, i) => (
                    <span key={i} className="step-chip">
                      {i > 0 && <ChevronRight size={12} />}
                      {step.name} <em>({step.agent})</em>
                    </span>
                  ))}
                  {wf.definition.loops?.map((loop) => (
                    <span key={loop.id} className="step-chip step-chip--loop">
                      <GitBranch size={12} />
                      loop:{loop.id} <em>({loop.maxIterations}× {loop.until})</em>
                      {loop.steps.map((step, i) => (
                        <span key={step.name}>
                          {i > 0 && <ChevronRight size={10} />}
                          {step.agent}
                        </span>
                      ))}
                    </span>
                  ))}
                </div>
                <button
                  id={`btn-execute-${wf.id}`}
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => handleExecute(wf.id)}
                  disabled={executeWf.isPending}
                >
                  <Play size={14} /> {executeWf.isPending ? 'Running...' : 'Execute'}
                </button>
              </div>
            ))}
          </div>

          <div className="workflow-output">
            <div className="card">
              <h3>Output</h3>
              <CodeEditor id="workflow-code-output" value={selectedCode} language="markdown" height="240px" />
            </div>
            <div className="card">
              <h3>Terminal</h3>
              <TerminalOutput id="workflow-terminal" lines={terminalOutput} />
            </div>
          </div>
        </div>
      )}

      <Modal id="modal-create-workflow" title="Create Workflow" open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="form-stack">
          <label htmlFor="input-wf-name">Workflow Name</label>
          <input id="input-wf-name" className="input" value={wfName} onChange={(e) => setWfName(e.target.value)} placeholder="feature-development" />

          <label>Steps</label>
          {steps.map((step, i) => (
            <div key={i} id={`step-editor-${i}`} className="step-editor">
              <input className="input" placeholder="Step name" value={step.name} onChange={(e) => updateStep(i, 'name', e.target.value)} />
              <select className="input" value={step.agent} onChange={(e) => updateStep(i, 'agent', e.target.value)}>
                {AGENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input className="input" placeholder="Capability" value={step.capability || ''} onChange={(e) => updateStep(i, 'capability', e.target.value)} />
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={addStep}>+ Add Step</button>

          <button id="btn-submit-workflow" type="button" className="btn btn--primary" onClick={handleCreate} disabled={createWf.isPending}>
            {createWf.isPending ? 'Creating...' : 'Create Workflow'}
          </button>
        </div>
      </Modal>
    </div>
  );
}