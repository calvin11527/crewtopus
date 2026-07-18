import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Bot,
  GitBranch,
  Columns3,
  Shield,
  ScrollText,
  Terminal,
} from 'lucide-react';
import { useHealth } from '../api/hooks';
import { wsClient } from '../api/client';
import { useAppStore, type ConnectionStatus } from '../stores/useAppStore';

const WS_STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  failed: 'Offline',
};

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', id: 'nav-dashboard' },
  { to: '/workspaces', icon: FolderKanban, label: 'Workspaces', id: 'nav-workspaces' },
  { to: '/agents', icon: Bot, label: 'Agents', id: 'nav-agents' },
  { to: '/board', icon: Columns3, label: 'Scrum Board', id: 'nav-board' },
  { to: '/workflows', icon: GitBranch, label: 'Workflows', id: 'nav-workflows' },
  { to: '/privacy', icon: Shield, label: 'Privacy', id: 'nav-privacy' },
  { to: '/audit', icon: ScrollText, label: 'Audit Log', id: 'nav-audit' },
  { to: '/logs', icon: Terminal, label: 'Server Logs', id: 'nav-logs' },
];

export default function Layout() {
  const { data: health } = useHealth();
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const online = health?.status === 'ok';

  return (
    <div id="app-layout" className="layout">
      <aside id="sidebar" className="sidebar">
        <div className="sidebar-header">
          <img
            src="/logo.svg"
            alt=""
            width={32}
            height={32}
            className="logo-icon logo-icon--img"
          />
          <div>
            <h1 className="logo-title">Crewtopus</h1>
            <p className="logo-subtitle">Many AI arms. One crew.</p>
          </div>
        </div>

        <nav id="sidebar-nav" className="sidebar-nav">
          {navItems.map(({ to, icon: Icon, label, id }) => (
            <NavLink
              key={to}
              id={id}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `nav-link${isActive ? ' nav-link--active' : ''}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status-row">
            <div className={`status-dot${online ? '' : ' status-dot--offline'}`} />
            <span id="system-status-label">{online ? 'System Online' : 'Degraded'}</span>
          </div>
          <div className="sidebar-status-row">
            <div
              className={`status-dot ws-status-dot ws-status-dot--${connectionStatus}`}
              aria-hidden
            />
            <span id="ws-connection-status" className="ws-connection-label">
              {WS_STATUS_LABEL[connectionStatus]}
            </span>
            {connectionStatus === 'failed' && (
              <button
                type="button"
                className="btn btn--ghost btn--sm ws-retry-btn"
                onClick={() => wsClient.retry()}
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </aside>

      <main id="main-content" className="main-content">
        {connectionStatus === 'connecting' && (
          <div className="ws-status-banner ws-status-banner--connecting" role="status">
            Reconnecting to live updates…
          </div>
        )}
        {connectionStatus === 'failed' && (
          <div className="ws-status-banner ws-status-banner--failed" role="alert">
            Live updates unavailable — automatic reconnect stopped. Use Retry in the sidebar or
            refresh the page.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}