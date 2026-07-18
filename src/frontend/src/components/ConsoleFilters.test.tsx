import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConsoleFilters from './ConsoleFilters';
import type { Agent } from '../types';

const agents: Agent[] = [
  {
    id: 'agent-grok',
    name: 'Grok',
    type: 'grok',
    enabled: true,
    status: 'idle',
    config: {},
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('ConsoleFilters', () => {
  it('renders search, agent, severity, and time-range controls', () => {
    render(<ConsoleFilters value={{}} onChange={() => {}} agents={agents} />);
    expect(screen.getByPlaceholderText('Search messages…')).toBeTruthy();
    expect(screen.getByLabelText('Agent type')).toBeTruthy();
    expect(screen.getByLabelText('Agent')).toBeTruthy();
    expect(screen.getByLabelText('Severity')).toBeTruthy();
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
  });

  it('calls onChange when filters are updated', () => {
    const onChange = vi.fn();
    render(<ConsoleFilters value={{}} onChange={onChange} agents={agents} />);

    fireEvent.change(screen.getByPlaceholderText('Search messages…'), {
      target: { value: 'timeout' },
    });
    expect(onChange).toHaveBeenCalledWith({ text: 'timeout' });

    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'error' } });
    expect(onChange).toHaveBeenCalledWith({ severity: 'error' });
  });

  it('updates agent type and date range filters', () => {
    const onChange = vi.fn();
    render(<ConsoleFilters value={{}} onChange={onChange} agents={agents} />);

    fireEvent.change(screen.getByLabelText('Agent type'), { target: { value: 'grok' } });
    expect(onChange).toHaveBeenCalledWith({ agentType: 'grok' });

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01T08:00' } });
    const fromCall = onChange.mock.calls.at(-1)?.[0] as { from?: string };
    expect(fromCall.from).toBeTruthy();

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-02T18:30' } });
    const toCall = onChange.mock.calls.at(-1)?.[0] as { to?: string };
    expect(toCall.to).toBeTruthy();
  });

  it('shows clear button when filters are active and resets state', () => {
    const onChange = vi.fn();
    render(
      <ConsoleFilters value={{ text: 'review', severity: 'warn' }} onChange={onChange} agents={agents} />
    );
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});