import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

const COMMANDS: Array<{ id: string; label: string; path: string; hint: string }> = [
  { id: 'dash', label: 'Dashboard', path: '/', hint: 'Overview' },
  { id: 'board', label: 'Scrum Board', path: '/board', hint: 'Sprint crew' },
  { id: 'agents', label: 'Agents', path: '/agents', hint: 'Registry + SuperGrok' },
  { id: 'ws', label: 'Workspaces', path: '/workspaces', hint: 'Repos' },
  { id: 'wf', label: 'Workflows', path: '/workflows', hint: 'Pipelines' },
  { id: 'privacy', label: 'Privacy', path: '/privacy', hint: 'Secret policies' },
  { id: 'audit', label: 'Audit Log', path: '/audit', hint: 'Runs' },
  { id: 'logs', label: 'Server Logs', path: '/logs', hint: 'Diagnostics' },
  {
    id: 'sg',
    label: 'SuperGrok helper page',
    path: '/supergrok-sync.html',
    hint: 'Bookmarklet',
  },
];

/** ⌘K / Ctrl+K navigation palette. */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(needle) || c.hint.toLowerCase().includes(needle)
    );
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQ('');
        setActive(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [q]);

  if (!open) return null;

  const go = (path: string) => {
    setOpen(false);
    if (path.endsWith('.html')) {
      window.open(path, '_blank');
      return;
    }
    navigate(path);
  };

  return (
    <div
      className="cmd-palette-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={() => setOpen(false)}
    >
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Go to… (↑↓ Enter, Esc)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && filtered[active]) {
              go(filtered[active].path);
            }
          }}
        />
        <ul className="cmd-palette-list">
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={i === active ? 'cmd-active' : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(c.path)}
              >
                <span>{c.label}</span>
                <span className="cmd-hint">{c.hint}</span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li>
              <button type="button" disabled>
                No matches
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
