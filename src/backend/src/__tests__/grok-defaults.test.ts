import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDatabase, getDatabase, initDatabase } from '../database';
import { listAgents, registerAgent } from '../modules/agent-registry';
import {
  applyGrokRunDefaults,
  DEFAULT_GROK_EFFORT,
  DEFAULT_GROK_MODEL,
  upgradeStoredGrokConfig,
} from '../modules/grok-defaults';

describe('grok run defaults', () => {
  it('fills model and effort only for new grok agents', () => {
    expect(applyGrokRunDefaults('grok', {})).toEqual({
      model: DEFAULT_GROK_MODEL,
      effort: DEFAULT_GROK_EFFORT,
    });
    expect(applyGrokRunDefaults('grok', { model: 'grok-4.7-build-fast', effort: 'low' })).toEqual({
      model: 'grok-4.7-build-fast',
      effort: 'low',
    });
    expect(applyGrokRunDefaults('copilot', {})).toEqual({});
  });

  it('upgrades legacy stored models and leaves explicit choices', () => {
    expect(upgradeStoredGrokConfig({ model: 'grok-4.5' })).toEqual({
      config: { model: 'grok-4.7', effort: 'medium' },
      changed: true,
    });
    expect(upgradeStoredGrokConfig({ model: 'grok-4.6', effort: 'high' })).toEqual({
      config: { model: 'grok-4.7', effort: 'high' },
      changed: true,
    });
    expect(upgradeStoredGrokConfig({ model: 'grok-4.7-build-fast', effort: 'low' })).toEqual({
      config: { model: 'grok-4.7-build-fast', effort: 'low' },
      changed: false,
    });
    expect(upgradeStoredGrokConfig({ model: 'grok-build' }).config).toEqual({
      model: 'grok-build',
      effort: 'medium',
    });
    expect(upgradeStoredGrokConfig({ model: 'grok-4.7', effort: 'xhigh' }).changed).toBe(false);
  });

  it('seeds the default grok agent with grok-4.7 and medium effort', () => {
    const grok = listAgents().find((agent) => agent.type === 'grok');
    expect(grok?.config.model).toBe('grok-4.7');
    expect(grok?.config.effort).toBe('medium');

    const hired = registerAgent(`Grok Hire ${Date.now()}`, 'grok', { model: 'grok-build' });
    expect(hired.config.model).toBe('grok-build');
    expect(hired.config.effort).toBe('medium');
  });

  it('migrates a schema v12 database without touching explicit grok choices', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-migrate-'));
    const dbPath = path.join(dir, 'crew.db');
    const previousCrew = process.env.CREWTOPUS_DB_PATH;
    const previousAgent = process.env.AGENTHUB_DB_PATH;

    const insert = (
      database: ReturnType<typeof getDatabase>,
      id: string,
      name: string,
      config: Record<string, unknown>
    ) => {
      database
        .prepare(
          `INSERT INTO agent (id, name, type, enabled, status, config, created_at)
           VALUES (?, ?, 'grok', 1, 'idle', ?, ?)`
        )
        .run(id, name, JSON.stringify(config), '2026-01-01T00:00:00.000Z');
    };

    try {
      closeDatabase();
      process.env.CREWTOPUS_DB_PATH = dbPath;
      process.env.AGENTHUB_DB_PATH = dbPath;
      const created = initDatabase();
      created.prepare('UPDATE schema_version SET version = 12').run();
      insert(created, 'legacy', 'Legacy Grok', { model: 'grok-4.5' });
      insert(created, 'prior', 'Prior CLI', { model: 'grok-4.6', effort: 'high' });
      insert(created, 'fast', 'Fast Grok', { model: 'grok-4.7-build-fast', effort: 'low' });
      insert(created, 'custom', 'Custom Grok', { model: 'grok-build' });
      insert(created, 'empty', 'Empty Grok', {});
      closeDatabase();

      initDatabase();
      const rows = getDatabase().prepare('SELECT id, config FROM agent ORDER BY id').all() as {
        id: string;
        config: string;
      }[];
      const byId = Object.fromEntries(rows.map((row) => [row.id, JSON.parse(row.config)]));
      expect(byId.legacy).toEqual({ model: 'grok-4.7', effort: 'medium' });
      expect(byId.prior).toEqual({ model: 'grok-4.7', effort: 'high' });
      expect(byId.fast).toEqual({ model: 'grok-4.7-build-fast', effort: 'low' });
      expect(byId.custom).toEqual({ model: 'grok-build', effort: 'medium' });
      expect(byId.empty).toEqual({ model: 'grok-4.7', effort: 'medium' });
      expect(getDatabase().prepare('SELECT version FROM schema_version').get()).toEqual({
        version: 13,
      });
    } finally {
      closeDatabase();
      if (previousCrew === undefined) delete process.env.CREWTOPUS_DB_PATH;
      else process.env.CREWTOPUS_DB_PATH = previousCrew;
      if (previousAgent === undefined) delete process.env.AGENTHUB_DB_PATH;
      else process.env.AGENTHUB_DB_PATH = previousAgent;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
