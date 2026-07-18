import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentConsole from './AgentConsole';
import { useAppStore } from '../stores/useAppStore';
import type { AgentConsoleStatus } from '../utils/work-item-console';

vi.mock('./StreamingConsole', () => ({
  default: () => <div data-testid="streaming-console" />,
}));

vi.mock('../hooks/useDragResize', () => ({
  useDragResize: () => ({
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
  }),
}));

const baseStatus: AgentConsoleStatus = {
  isLive: false,
  loopStatus: 'idle',
  phase: undefined,
  agentType: undefined,
};

function renderConsole(connectionStatus: 'connected' | 'connecting' | 'failed') {
  useAppStore.setState({ connectionStatus });
  return render(
    <AgentConsole
      workItemKey="AH-63"
      entries={[]}
      status={baseStatus}
      sessionKey={1}
      height={200}
      onResizeHeight={vi.fn()}
      onClear={vi.fn()}
    />
  );
}

describe('AgentConsole WebSocket status badge', () => {
  it('shows Connected when live socket is up', () => {
    renderConsole('connected');
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();
  });

  it('shows Connecting… while reconnecting', () => {
    renderConsole('connecting');
    expect(screen.getByText('Connecting…')).toBeTruthy();
  });

  it('shows Offline after reconnect exhaustion', () => {
    renderConsole('failed');
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('shows LIVE pulse only when connected and streaming', () => {
    useAppStore.setState({ connectionStatus: 'connected' });
    render(
      <AgentConsole
        workItemKey="AH-63"
        entries={[]}
        status={{ ...baseStatus, isLive: true }}
        sessionKey={1}
        height={200}
        onResizeHeight={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expect(screen.getByText('LIVE')).toBeTruthy();
  });
});