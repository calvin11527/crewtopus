import type { WorkItem, Workspace } from '../types';

/** Retry policy for transient adapter failures. */
export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number[];
  retryOn: Array<'timeout' | 'exit_nonzero' | 'rate_limit'>;
}

/** Resolved harness configuration for a single outbound run. */
export interface HarnessProfile {
  tokenBudget: number;
  maxSensitivity: number;
  retryPolicy: RetryPolicy;
  auditSnapshots: boolean;
  cliMaxOutputBytes: number;
  allowedWriteRoots: string[];
  implementationPermission: 'bypassPermissions' | 'acceptEdits' | 'plan';
  /** `readOnly` is accepted in workspace config and mapped to `plan` for Grok CLI. */
  reviewPermission: 'acceptEdits' | 'plan' | 'readOnly';
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: [1000, 4000, 16000],
  retryOn: ['timeout', 'exit_nonzero'],
};

const DEFAULT_PROFILE: HarnessProfile = {
  tokenBudget: 8000,
  maxSensitivity: 3,
  retryPolicy: DEFAULT_RETRY_POLICY,
  auditSnapshots: process.env.AGENTHUB_AUDIT_SNAPSHOTS !== 'false',
  cliMaxOutputBytes: Number(process.env.AGENTHUB_CLI_MAX_OUTPUT_BYTES) || 10 * 1024 * 1024,
  allowedWriteRoots: [],
  implementationPermission: 'bypassPermissions',
  reviewPermission: 'plan',
};

/** Merge defaults → workspace config → work item metadata → env overrides. */
export function resolveHarnessProfile(
  workspace?: Workspace | null,
  workItem?: WorkItem | null
): HarnessProfile {
  const wsConfig = workspace?.config ?? {};
  const itemMeta = (workItem as { metadata?: Record<string, unknown> } | undefined)?.metadata ?? {};

  const tokenBudget =
    typeof itemMeta.contextMaxTokens === 'number'
      ? itemMeta.contextMaxTokens
      : typeof wsConfig.contextMaxTokens === 'number'
        ? wsConfig.contextMaxTokens
        : DEFAULT_PROFILE.tokenBudget;

  const maxAttempts =
    typeof itemMeta.retryMaxAttempts === 'number'
      ? itemMeta.retryMaxAttempts
      : typeof wsConfig.retryMaxAttempts === 'number'
        ? wsConfig.retryMaxAttempts
        : DEFAULT_RETRY_POLICY.maxAttempts;

  const implPerm = wsConfig.implementationPermission as HarnessProfile['implementationPermission'] | undefined;
  const reviewPerm = wsConfig.reviewPermission as HarnessProfile['reviewPermission'] | undefined;

  return {
    tokenBudget,
    maxSensitivity: DEFAULT_PROFILE.maxSensitivity,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, maxAttempts },
    auditSnapshots: DEFAULT_PROFILE.auditSnapshots,
    cliMaxOutputBytes: DEFAULT_PROFILE.cliMaxOutputBytes,
    allowedWriteRoots: DEFAULT_PROFILE.allowedWriteRoots,
    implementationPermission: implPerm ?? DEFAULT_PROFILE.implementationPermission,
    reviewPermission: reviewPerm ?? DEFAULT_PROFILE.reviewPermission,
  };
}