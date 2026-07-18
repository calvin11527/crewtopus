import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Layout from './Layout';
import { useAppStore, type ConnectionStatus } from '../stores/useAppStore';

vi.mock('../api/hooks', () => ({
  useHealth: () => ({ data: { status: 'ok' } }),
}));

const retryMock = vi.fn();
vi.mock('../api/client', () => ({
  wsClient: { retry: () => retryMock() },
}));

function renderLayout(status: ConnectionStatus) {
  useAppStore.setState({ connectionStatus: status });
  return render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>
  );
}

describe('Layout WebSocket status', () => {
  beforeEach(() => {
    retryMock.mockClear();
  });

  it('shows Live when connected', () => {
    renderLayout('connected');
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows connecting banner while reconnecting', () => {
    renderLayout('connecting');
    expect(screen.getByText('Connecting…')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Reconnecting to live updates');
  });

  it('shows offline label, alert banner, and retry on failed', () => {
    renderLayout('failed');
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Live updates unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryMock).toHaveBeenCalledTimes(1);
  });
});