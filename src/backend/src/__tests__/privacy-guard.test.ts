import type { ContextScope } from '../types';
import {
  scanForSecrets,
  sanitizePaths,
  redactScope,
  runPrivacyGuard,
  isPlaceholderSecret,
} from '../modules/privacy-guard';
import { dedupeDefaultPolicies } from '../modules/seed-policies';
import { getDatabase } from '../database';

function makeScope(overrides: Partial<ContextScope> = {}): ContextScope {
  return {
    files: [],
    diffs: [],
    symbols: [],
    maxTokens: 8000,
    sensitivityLevel: 0,
    ...overrides,
  };
}

describe('Privacy Guard', () => {
  it('should detect OpenAI API keys', () => {
    const content = 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456"';
    const matches = scanForSecrets(content, 'test');
    expect(matches.some((m) => m.type === 'api_key')).toBe(true);
  });

  it('should detect JWT tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const matches = scanForSecrets(jwt, 'test');
    expect(matches.some((m) => m.type === 'jwt')).toBe(true);
  });

  it('should detect PII email addresses', () => {
    const matches = scanForSecrets('Contact user@acme-corp.io for details', 'test');
    expect(matches.some((m) => m.type === 'pii')).toBe(true);
    // example.com is treated as documentation placeholder
    expect(scanForSecrets('Contact user@example.com for details', 'docs').some((m) => m.type === 'pii')).toBe(
      false
    );
  });

  it('should block outbound secrets', () => {
    const scope = makeScope({
      files: ['const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456"'],
    });
    const result = runPrivacyGuard(scope, 'mock');
    expect(result.passed).toBe(false);
    expect(result.blockedReasons.length).toBeGreaterThan(0);
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it('should block sensitive file paths', () => {
    const scope = makeScope({ files: ['safe content'] });
    const result = runPrivacyGuard(scope, 'mock', ['.env', 'src/index.ts']);
    expect(result.passed).toBe(false);
    expect(result.blockedReasons.some((r) => r.includes('.env'))).toBe(true);
  });

  it('should redact secrets from scope content', () => {
    const scope = makeScope({
      files: ['token=sk-abcdefghijklmnopqrstuvwxyz123456'],
      diffs: ['password: "hunter2"'],
    });
    const redacted = redactScope(scope);
    expect(redacted.files[0]).toContain('[REDACTED]');
    expect(redacted.files[0]).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('should allow clean outbound context', () => {
    const scope = makeScope({
      files: ['// index.ts\nexport function greet() { return "hello"; }'],
      symbols: ['greet'],
    });
    const result = runPrivacyGuard(scope, 'mock', ['src/index.ts']);
    expect(result.passed).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  it('should ignore documentation placeholders like KEY=your_key_here', () => {
    expect(isPlaceholderSecret('KEY=your_key_here')).toBe(true);
    expect(isPlaceholderSecret('API_KEY=<paste_here>')).toBe(true);
    expect(isPlaceholderSecret('sk-abcdefghijklmnopqrstuvwxyz123456')).toBe(false);

    const matches = scanForSecrets(
      '# Setup\nexport KEY=your_key_here\nexport API_KEY=example_token_value\n',
      'README.md'
    );
    expect(matches).toHaveLength(0);

    const scope = makeScope({
      files: ['// README.md\n# Stock System\nSet KEY=your_key_here in .env\n'],
      sensitivityLevel: 0,
    });
    const result = runPrivacyGuard(scope, 'copilot', ['README.md']);
    expect(result.passed).toBe(true);
    expect(result.matches).toHaveLength(0);
  });

  it('should not block process.env references in source files', () => {
    const scope = makeScope({
      files: ['// src/index.ts\nconst port = process.env.PORT || 3000;'],
      sensitivityLevel: 0,
    });
    const result = runPrivacyGuard(scope, 'mock', ['src/index.ts']);
    expect(result.passed).toBe(true);
    expect(result.blockedReasons.some((r) => r.includes('blocked path pattern ".env"'))).toBe(false);
  });

  it('should block actual .env files in context by path', () => {
    const scope = makeScope({
      files: ['// config/.env\nSECRET=abc123'],
      sensitivityLevel: 0,
    });
    const result = runPrivacyGuard(scope, 'mock');
    expect(result.passed).toBe(false);
    expect(result.blockedReasons.some((r) => r.includes('blocked path pattern ".env"'))).toBe(true);
  });

  it('should block high-sensitivity cloud agent per policy', () => {
    const scope = makeScope({
      files: ['internal design notes'],
      sensitivityLevel: 3,
    });
    const result = runPrivacyGuard(scope, 'claude');
    expect(result.passed).toBe(false);
    expect(result.blockedReasons.some((r) => r.includes('requires local agent'))).toBe(true);
  });

  it('should dedupe duplicate default privacy policies', () => {
    const db = getDatabase();
    const before = db
      .prepare('SELECT COUNT(*) as c FROM privacy_policy WHERE workspace_id IS NULL AND name = ?')
      .get('Default Privacy Policy') as { c: number };

    db.prepare(
      'INSERT INTO privacy_policy (id, workspace_id, name, rules, created_at) VALUES (?, NULL, ?, ?, ?)'
    ).run('dup-policy-test', 'Default Privacy Policy', '[]', new Date().toISOString());

    dedupeDefaultPolicies();

    const after = db
      .prepare('SELECT COUNT(*) as c FROM privacy_policy WHERE workspace_id IS NULL AND name = ?')
      .get('Default Privacy Policy') as { c: number };

    expect(after.c).toBe(1);
    expect(before.c).toBeGreaterThanOrEqual(1);
  });

  it('should sanitize paths and block credentials files', () => {
    const basePath = '/tmp/agenthub-project';
    const { safe, blocked } = sanitizePaths(
      ['src/app.ts', 'credentials.json', '.ssh/id_rsa'],
      basePath
    );
    expect(safe).toEqual(['src/app.ts']);
    expect(blocked).toEqual(expect.arrayContaining(['credentials.json', '.ssh/id_rsa']));
    expect(blocked).toHaveLength(2);
  });
});