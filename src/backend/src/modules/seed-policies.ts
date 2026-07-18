import { getDatabase } from '../database';
import { generateId, now } from '../utils/helpers';

const DEFAULT_POLICY_NAME = 'Default Privacy Policy';

const DEFAULT_POLICY_RULES = [
  { type: 'require_local', value: 3, description: 'Sensitivity 3+ must use local Ollama agent' },
  { type: 'max_sensitivity', value: 3, description: 'Maximum outbound sensitivity level' },
  { type: 'block_path', value: '.env', description: 'Block .env files from outbound context' },
];

/** Remove duplicate global default policies (keeps oldest row). */
export function dedupeDefaultPolicies(): void {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT id FROM privacy_policy WHERE workspace_id IS NULL AND name = ? ORDER BY created_at ASC'
    )
    .all(DEFAULT_POLICY_NAME) as Array<{ id: string }>;

  for (const row of rows.slice(1)) {
    db.prepare('DELETE FROM privacy_policy WHERE id = ?').run(row.id);
  }
}

/** Seed default privacy policies if none exist. */
export function seedDefaultPolicies(): void {
  dedupeDefaultPolicies();

  const existing = getDatabase()
    .prepare('SELECT id FROM privacy_policy WHERE workspace_id IS NULL AND name = ?')
    .get(DEFAULT_POLICY_NAME) as { id: string } | undefined;
  if (existing) return;

  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare('INSERT INTO privacy_policy (id, workspace_id, name, rules, created_at) VALUES (?, NULL, ?, ?, ?)')
    .run(id, DEFAULT_POLICY_NAME, JSON.stringify(DEFAULT_POLICY_RULES), timestamp);
}