import { Activity, Bot, GitBranch, Shield, Zap, DollarSign } from 'lucide-react';
import { useHealth, useSystemStatus, useAuditStats, useSupervisorStatus, useAgents, useWorkflows } from '../api/hooks';
import LiveFeed from '../components/LiveFeed';
import CreditUsage from '../components/CreditUsage';

export default function Dashboard() {
  const { data: health } = useHealth();
  const { data: status } = useSystemStatus();
  const { data: auditStats } = useAuditStats();
  const { data: supervisor } = useSupervisorStatus();
  const { data: agents } = useAgents();
  const { data: workflows } = useWorkflows();

  const activeAgents = agents?.filter((a) => a.enabled && a.status === 'running').length ?? 0;
  const totalAgents = agents?.length ?? 0;
  const activeWorkflows = workflows?.filter((w) => w.status === 'active').length ?? 0;

  return (
    <div id="page-dashboard" className="page page--wide">
      <header className="page-header">
        <h2>Dashboard</h2>
        <p className="page-subtitle">Multi-agent orchestration command center</p>
      </header>

      <div className="stats-grid">
        <div id="stat-uptime" className="stat-card">
          <Activity size={22} className="stat-icon stat-icon--blue" />
          <div>
            <span className="stat-label">Uptime</span>
            <span className="stat-value">{status?.uptime ?? 0}s</span>
          </div>
        </div>
        <div id="stat-agents" className="stat-card">
          <Bot size={22} className="stat-icon stat-icon--purple" />
          <div>
            <span className="stat-label">Agents Active</span>
            <span className="stat-value">{activeAgents}/{totalAgents}</span>
          </div>
        </div>
        <div id="stat-workflows" className="stat-card">
          <GitBranch size={22} className="stat-icon stat-icon--green" />
          <div>
            <span className="stat-label">Active Workflows</span>
            <span className="stat-value">{activeWorkflows}</span>
          </div>
        </div>
        <div id="stat-tasks" className="stat-card">
          <Zap size={22} className="stat-icon stat-icon--amber" />
          <div>
            <span className="stat-label">Supervisor Tasks</span>
            <span className="stat-value">{supervisor?.activeTasks ?? 0}</span>
          </div>
        </div>
        <div id="stat-tokens" className="stat-card">
          <Shield size={22} className="stat-icon stat-icon--blue" />
          <div>
            <span className="stat-label">Total Tokens</span>
            <span className="stat-value">{auditStats?.totalTokens?.toLocaleString() ?? 0}</span>
          </div>
        </div>
        <div id="stat-cost" className="stat-card">
          <DollarSign size={22} className="stat-icon stat-icon--green" />
          <div>
            <span className="stat-label">Est. Cost</span>
            <span className="stat-value">${(auditStats?.totalCost ?? 0).toFixed(4)}</span>
          </div>
        </div>
      </div>

      <CreditUsage compact />

      <div className="dashboard-grid">
        <LiveFeed />
        <div id="system-info" className="card">
          <h3>System Status</h3>
          <dl className="info-list">
            <div><dt>Version</dt><dd>{health?.version ?? '—'}</dd></div>
            <div><dt>Database</dt><dd>{health?.database ? 'Connected' : 'Offline'}</dd></div>
            <div><dt>WebSocket Clients</dt><dd>{status?.websocketClients ?? 0}</dd></div>
            <div><dt>Audit Entries</dt><dd>{auditStats?.totalEntries ?? 0}</dd></div>
            <div><dt>Blocked Requests</dt><dd>{auditStats?.blockedCount ?? 0}</dd></div>
            <div><dt>Locked Agents</dt><dd>{supervisor?.lockedAgents ?? 0}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  );
}