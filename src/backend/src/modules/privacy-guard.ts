import path from 'path';
import type { ContextScope, AgentType } from '../types';
import { getDatabase } from '../database';
import { parseJson } from '../utils/helpers';
import { getWorkspace } from './workspace';

export type SecretType =
  | 'api_key'
  | 'jwt'
  | 'password'
  | 'private_key'
  | 'certificate'
  | 'pii'
  | 'env_var';

export interface SecretMatch {
  type: SecretType;
  pattern: string;
  location: string;
  redacted: string;
  matchedValue: string;
}

export interface PrivacyScanResult {
  passed: boolean;
  matches: SecretMatch[];
  sanitizedScope: ContextScope;
  blockedReasons: string[];
  redacted?: boolean;
  requiresApproval?: boolean;
}

export interface PrivacyPolicy {
  id: string;
  workspaceId?: string;
  name: string;
  rules: PrivacyRule[];
  createdAt: string;
}

export type PrivacyRuleAction = 'block' | 'redact_and_continue' | 'require_approval';

export interface PrivacyRule {
  type: 'block_path' | 'block_pattern' | 'require_local' | 'max_sensitivity';
  value: string | number;
  description?: string;
  action?: PrivacyRuleAction;
}

/** Demo/test key prefixes that may be redacted instead of blocked when secretPolicy allows. */
const DEMO_SECRET_PREFIXES = ['sk-test', 'demo_key_', 'test_api_key_'];

function isDemoSecret(value: string): boolean {
  return DEMO_SECRET_PREFIXES.some((p) => value.includes(p));
}

/**
 * Documentation / template placeholders that look like env assignments but are not real secrets
 * (e.g. README `KEY=your_key_here`, `API_KEY=<paste>`).
 */
export function isPlaceholderSecret(value: string): boolean {
  const raw = value.trim();
  if (!raw) return true;

  const eq = raw.search(/[:=]/);
  let rhs = eq >= 0 ? raw.slice(eq + 1).trim() : raw;
  rhs = rhs.replace(/^['"`]+|['"`]+$/g, '').trim();

  if (!rhs) return true;
  // Too short / obvious fillers (avoid nested quantifiers for ReDoS safety)
  if (rhs.length < 8) return true;
  if (/^[xyz*.\-]+$/i.test(rhs)) return true;
  if (
    rhs === 'null' ||
    rhs === 'none' ||
    rhs === 'undefined' ||
    rhs === 'true' ||
    rhs === 'false' ||
    rhs === 'todo' ||
    rhs === 'tbd' ||
    rhs === 'n/a' ||
    rhs === 'na'
  ) {
    return true;
  }

  // Common doc placeholders
  const lower = rhs.toLowerCase();
  const placeholderTokens = [
    'your_', 'your-', 'my_', 'my-', 'example', 'sample', 'dummy', 'placeholder',
    'changeme', 'replace', 'insert', 'paste', 'xxx', 'yyy', 'zzz', 'foo', 'bar',
    'baz', 'qux', 'test_key', 'test-key', 'api_key_here', 'apikeyhere',
  ];
  if (placeholderTokens.some((t) => lower.includes(t))) return true;
  if (lower.endsWith('_here') || lower.endsWith('-here')) return true;
  // Bracketed fillers like <paste> or {KEY} without nested quantifiers
  if (
    (rhs.startsWith('<') && rhs.endsWith('>')) ||
    (rhs.startsWith('{') && rhs.endsWith('}')) ||
    (rhs.startsWith('[') && rhs.endsWith(']'))
  ) {
    return true;
  }

  // Only skip clearly fake short OpenAI-style placeholders (not sk-test + long random used in tests)
  if (/^sk-(?:xxx+|test-?x+|demo-?x+|fake-?x+)$/i.test(rhs)) return true;

  return false;
}

const SECRET_PATTERNS: Array<{ type: SecretType; pattern: RegExp; label: string }> = [
  { type: 'api_key', pattern: /sk-test-[a-zA-Z0-9_-]{8,}/g, label: 'Demo/test API key' },
  { type: 'api_key', pattern: /demo_key_[a-zA-Z0-9_-]{8,}/g, label: 'Demo key' },
  { type: 'api_key', pattern: /test_api_key_[a-zA-Z0-9_-]{8,}/g, label: 'Test API key' },
  { type: 'api_key', pattern: /sk-[a-zA-Z0-9]{20,}/g, label: 'OpenAI API key' },
  { type: 'api_key', pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key' },
  { type: 'api_key', pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{16,}/gi, label: 'API key assignment' },
  { type: 'jwt', pattern: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, label: 'JWT token' },
  { type: 'password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi, label: 'Password assignment' },
  { type: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: 'Private key' },
  { type: 'certificate', pattern: /-----BEGIN CERTIFICATE-----/g, label: 'Certificate' },
  { type: 'pii', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, label: 'Email address' },
  { type: 'pii', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, label: 'SSN pattern' },
  { type: 'env_var', pattern: /(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL)[_A-Z]*\s*=\s*\S+/g, label: 'Sensitive env var' },
];

const BLOCKED_PATH_PATTERNS = [
  /\.env/i,
  /\.ssh\//i,
  /id_rsa/i,
  /credentials/i,
  /\.pem$/i,
  /\.key$/i,
  /secrets?\./i,
];

/** Scan text content for secrets (skips documentation placeholders). */
export function scanForSecrets(content: string, location: string): SecretMatch[] {
  const matches: SecretMatch[] = [];

  for (const { type, pattern, label } of SECRET_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const value = match[0];
      if (isPlaceholderSecret(value)) continue;
      // example.com emails in docs are not PII for outbound policy
      if (type === 'pii' && /@example\.(com|org|net)\b/i.test(value)) continue;
      matches.push({
        type,
        pattern: label,
        location,
        redacted: value.slice(0, 4) + '****' + value.slice(-4),
        matchedValue: value,
      });
    }
  }

  return matches;
}

/** Sanitize file paths — block sensitive paths and redact home directories. */
export function sanitizePaths(filePaths: string[], basePath?: string): { safe: string[]; blocked: string[] } {
  const safe: string[] = [];
  const blocked: string[] = [];
  const base = basePath || process.cwd();
  const homeDir = process.env.HOME || '';

  for (const filePath of filePaths) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(base, filePath);
    const rel = path.relative(base, resolved);

    const isBlocked = BLOCKED_PATH_PATTERNS.some((p) => p.test(rel) || p.test(resolved));
    if (isBlocked) {
      blocked.push(rel);
      continue;
    }

    let sanitized = rel;
    if (homeDir && resolved.startsWith(homeDir)) {
      sanitized = '~' + resolved.slice(homeDir.length);
    }
    safe.push(sanitized);
  }

  return { safe, blocked };
}

/** Redact secrets from context scope content. */
export function redactScope(scope: ContextScope): ContextScope {
  const redact = (text: string): string => {
    let result = text;
    for (const { pattern } of SECRET_PATTERNS) {
      result = result.replace(new RegExp(pattern.source, pattern.flags), '[REDACTED]');
    }
    return result;
  };

  return {
    ...scope,
    files: scope.files.map(redact),
    diffs: scope.diffs.map(redact),
  };
}

/** Load privacy policies, optionally filtered by workspace. */
export function listPolicies(workspaceId?: string): PrivacyPolicy[] {
  const db = getDatabase();
  const rows = workspaceId
    ? (db.prepare('SELECT * FROM privacy_policy WHERE workspace_id = ? OR workspace_id IS NULL').all(workspaceId) as PolicyRow[])
    : (db.prepare('SELECT * FROM privacy_policy').all() as PolicyRow[]);

  return rows.map(mapPolicy);
}

interface PolicyRow {
  id: string;
  workspace_id: string | null;
  name: string;
  rules: string;
  created_at: string;
}

function mapPolicy(row: PolicyRow): PrivacyPolicy {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? undefined,
    name: row.name,
    rules: parseJson<PrivacyRule[]>(row.rules, []),
    createdAt: row.created_at,
  };
}

export interface PolicyEvaluation {
  violations: string[];
  redactActions: string[];
  approvalActions: string[];
}

/** Extract the relative path from a context file block (`// path\\ncontent`). */
export function contextFilePath(fileBlock: string): string {
  const match = fileBlock.match(/^\/\/ (.+)$/m);
  return match?.[1] ?? fileBlock;
}

function pathMatchesBlockPattern(relPath: string, pattern: string): boolean {
  const normalized = relPath.split(path.sep).join('/');
  if (pattern.startsWith('.')) {
    const base = path.basename(normalized);
    return base === pattern || base.startsWith(`${pattern}.`);
  }
  return normalized.includes(pattern);
}

/** Evaluate policies against a context scope and agent type. */
export function evaluatePolicies(
  scope: ContextScope,
  agentType: AgentType,
  workspaceId?: string
): PolicyEvaluation {
  const violations: string[] = [];
  const redactActions: string[] = [];
  const approvalActions: string[] = [];
  const policies = listPolicies(workspaceId);

  for (const policy of policies) {
    for (const rule of policy.rules) {
      const action = rule.action ?? 'block';
      const msg = (text: string) => `Policy "${policy.name}": ${text}`;

      switch (rule.type) {
        case 'max_sensitivity':
          if (scope.sensitivityLevel > (rule.value as number)) {
            violations.push(msg(`sensitivity ${scope.sensitivityLevel} exceeds max ${rule.value}`));
          }
          break;
        case 'require_local':
          if (scope.sensitivityLevel >= (rule.value as number) && agentType !== 'ollama') {
            violations.push(msg(`sensitivity ${scope.sensitivityLevel} requires local agent`));
          }
          break;
        case 'block_path':
          for (const file of scope.files) {
            const rel = contextFilePath(file);
            if (!pathMatchesBlockPattern(rel, String(rule.value))) continue;
            const text = msg(`blocked path pattern "${rule.value}"`);
            if (action === 'redact_and_continue') redactActions.push(text);
            else if (action === 'require_approval') approvalActions.push(text);
            else violations.push(text);
          }
          break;
        case 'block_pattern': {
          const pattern = new RegExp(rule.value as string, 'i');
          for (const file of scope.files) {
            if (pattern.test(file)) {
              const text = msg(`blocked content pattern "${rule.value}"`);
              if (action === 'redact_and_continue') redactActions.push(text);
              else if (action === 'require_approval') approvalActions.push(text);
              else violations.push(text);
            }
          }
          break;
        }
      }
    }
  }

  return { violations, redactActions, approvalActions };
}

/**
 * Run the full privacy guard pipeline on a ContextScope.
 * Returns passed=false if outbound request must be blocked.
 */
export function runPrivacyGuard(
  scope: ContextScope,
  agentType: AgentType,
  filePaths: string[] = [],
  basePath?: string,
  workspaceId?: string
): PrivacyScanResult {
  const matches: SecretMatch[] = [];
  const blockedReasons: string[] = [];

  const maxFiles = Math.min(scope.files.length, 5_000);
  const maxDiffs = Math.min(scope.diffs.length, 5_000);
  for (let i = 0; i < maxFiles; i++) {
    matches.push(...scanForSecrets(scope.files[i], `files[${i}]`));
  }
  for (let i = 0; i < maxDiffs; i++) {
    matches.push(...scanForSecrets(scope.diffs[i], `diffs[${i}]`));
  }

  const { blocked: blockedPaths } = sanitizePaths(filePaths, basePath);
  if (blockedPaths.length > 0) {
    blockedReasons.push(`Blocked sensitive paths: ${blockedPaths.join(', ')}`);
  }

  const policyEval = evaluatePolicies(scope, agentType, workspaceId);
  blockedReasons.push(...policyEval.violations);

  const workspace = workspaceId ? getWorkspace(workspaceId) : null;
  const secretPolicy =
    (workspace?.config.secretPolicy as string | undefined) ||
    process.env.AGENTHUB_SECRET_POLICY ||
    'block';
  const allowSecretRedact = secretPolicy === 'redact_and_continue';

  const blockingMatches = matches.filter(
    (m) => !allowSecretRedact || !isDemoSecret(m.matchedValue)
  );
  const secretOnlyIssue = matches.length > 0;
  const hasBlockingSecrets = blockingMatches.length > 0;

  if (hasBlockingSecrets && !allowSecretRedact && policyEval.redactActions.length === 0) {
    blockedReasons.push(`Detected ${blockingMatches.length} secret(s) in outbound context`);
  }

  const needsRedact = secretOnlyIssue || policyEval.redactActions.length > 0;
  const sanitizedScope = needsRedact ? redactScope(scope) : scope;
  const requiresApproval = policyEval.approvalActions.length > 0;

  if (requiresApproval) {
    blockedReasons.push(...policyEval.approvalActions.map((a) => `${a} (requires approval)`));
  }

  const canRedactAndContinue =
    blockedPaths.length === 0 &&
    policyEval.violations.length === 0 &&
    !requiresApproval &&
    needsRedact &&
    (allowSecretRedact || policyEval.redactActions.length > 0) &&
    (!hasBlockingSecrets || allowSecretRedact);

  if (canRedactAndContinue && secretOnlyIssue) {
    return {
      passed: true,
      matches,
      sanitizedScope,
      blockedReasons: [`Redacted ${matches.length} secret(s) and continued`],
      redacted: true,
      requiresApproval: false,
    };
  }

  return {
    passed: blockedReasons.length === 0,
    matches,
    sanitizedScope,
    blockedReasons,
    redacted: needsRedact,
    requiresApproval,
  };
}