import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as logExport from '../utils/log-export';
import Logs from './Logs';

const mockUseLogEvents = vi.fn();
const mockUseAgents = vi.fn();

vi.mock('../api/hooks', () => ({
  useAgents: () => mockUseAgents(),
  useLogEvents: (filters: unknown) => mockUseLogEvents(filters),
}));

describe('Logs page export and copy', () => {
  beforeEach(() => {
    mockUseAgents.mockReturnValue({ data: [] });
    mockUseLogEvents.mockReturnValue({
      data: {
        pages: [
          {
            items: [
              {
                id: 'evt-1',
                severity: 'warn',
                message: 'pipeline stalled',
                createdAt: '2026-06-28T14:30:00.000Z',
                agentType: 'grok',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          },
        ],
      },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isError: false,
      error: null,
    });
  });

  it('renders export actions for filtered logs', () => {
    render(<Logs />);
    expect(screen.getByRole('button', { name: /export filtered logs as log file/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /export filtered logs as json/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy selected log line/i })).toBeTruthy();
  });

  it('exports filtered logs as log file via export helper', () => {
    const exportSpy = vi.spyOn(logExport, 'exportLogEventsFile').mockImplementation(() => {});

    render(<Logs />);
    fireEvent.click(screen.getByRole('button', { name: /export filtered logs as log file/i }));

    expect(exportSpy).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'evt-1', message: 'pipeline stalled' })],
      'log',
      undefined
    );

    exportSpy.mockRestore();
  });

  it('exports filtered logs as json via export helper', () => {
    const exportSpy = vi.spyOn(logExport, 'exportLogEventsFile').mockImplementation(() => {});

    render(<Logs />);
    fireEvent.click(screen.getByRole('button', { name: /export filtered logs as json/i }));

    expect(exportSpy).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'evt-1', message: 'pipeline stalled' })],
      'json',
      undefined
    );

    exportSpy.mockRestore();
  });

  it('enables copy after selecting a line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<Logs />);
    const copyBtn = screen.getByRole('button', { name: /copy selected log line/i });
    expect(copyBtn.hasAttribute('disabled')).toBe(true);

    const gutter = screen
      .getByText(/pipeline stalled/i)
      .closest('[role="option"]')!
      .querySelector('.streaming-console-line-gutter')!;
    fireEvent.click(gutter);

    expect(copyBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(copyBtn);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        '[2026-06-28T14:30:00.000Z] WARN [grok] pipeline stalled'
      );
    });
  });
});