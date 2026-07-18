import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CreditUsage from './CreditUsage';
import type { AgentCreditUsage } from '../types';

vi.mock('../api/hooks', () => ({
  useAgentCredits: () => ({
    data: [
      {
        agentId: 'grok-1',
        agentName: 'Grok',
        agentType: 'grok',
        enabled: true,
        creditLimit: 5000,
        creditsUsed: 3900,
        creditsRemaining: 1100,
        percentageUsed: 78,
        unlimited: false,
        overBudget: false,
        tokenCount: 1000,
        requestCount: 5,
        trackingSource: 'agenthub_audit',
      } satisfies AgentCreditUsage,
    ],
    isLoading: false,
  }),
}));

describe('CreditUsage', () => {
  it('renders 78% total usage for mock grok data', () => {
    render(<CreditUsage />);
    expect(screen.getByText('Grok', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('78%')).toBeTruthy();
    expect(screen.getByText(/Total usage across all grok agents/i)).toBeTruthy();
    expect(screen.getByText(/Agent Credit Usage/i)).toBeTruthy();
  });
});