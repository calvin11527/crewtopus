import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(__dirname, '..', 'data');

let db: Database.Database | null = null;

function getDbPath(): string {
  return process.env.AGENTHUB_DB_PATH || path.join(DATA_DIR, 'agenthub.db');
}

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  )`,

  `CREATE TABLE IF NOT EXISTS workspace (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS repository (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    remote_url TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS agent (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'idle',
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS capability (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS workflow (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    name TEXT NOT NULL,
    definition TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS workflow_execution (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    current_step INTEGER NOT NULL DEFAULT 0,
    result TEXT,
    started_at TEXT,
    completed_at TEXT,
    loop_results TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflow(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS event (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    workflow_id TEXT,
    task TEXT,
    context_hash TEXT NOT NULL,
    files TEXT NOT NULL DEFAULT '[]',
    token_count INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    approval_status TEXT,
    response_metadata TEXT,
    timestamp TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS approval_request (
    id TEXT PRIMARY KEY,
    workflow_id TEXT,
    context_scope TEXT NOT NULL,
    sensitivity_level INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS privacy_policy (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    name TEXT NOT NULL,
    rules TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_repository_workspace ON repository(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_capability_agent ON capability(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_workspace ON workflow(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_execution_workflow ON workflow_execution(workflow_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_event_created_at ON event(created_at)`,

  `CREATE TABLE IF NOT EXISTS proactive_trigger (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    trigger_type TEXT NOT NULL,
    workflow_id TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES workflow(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS consensus_session (
    id TEXT PRIMARY KEY,
    workflow_id TEXT,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    question TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    decision TEXT,
    decision_source TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflow(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS consensus_vote (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    agent_type TEXT NOT NULL,
    opinion TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES consensus_session(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_proactive_trigger_workspace ON proactive_trigger(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_consensus_vote_session ON consensus_vote(session_id)`,

  `CREATE TABLE IF NOT EXISTS sprint (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    name TEXT NOT NULL,
    goal TEXT,
    status TEXT NOT NULL DEFAULT 'planning',
    start_date TEXT,
    end_date TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS work_item (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    workspace_id TEXT,
    sprint_id TEXT,
    parent_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'backlog',
    priority TEXT NOT NULL DEFAULT 'medium',
    story_points INTEGER,
    assigned_agent_id TEXT,
    assigned_agent_type TEXT,
    workflow_id TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    acceptance_criteria TEXT NOT NULL DEFAULT '[]',
    loop_iteration INTEGER NOT NULL DEFAULT 0,
    max_loop_iterations INTEGER NOT NULL DEFAULT 3,
    loop_status TEXT NOT NULL DEFAULT 'idle',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE SET NULL,
    FOREIGN KEY (sprint_id) REFERENCES sprint(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id) REFERENCES work_item(id) ON DELETE SET NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflow(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS work_item_activity (
    id TEXT PRIMARY KEY,
    work_item_id TEXT NOT NULL,
    agent_id TEXT,
    agent_type TEXT,
    activity_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    audit_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (work_item_id) REFERENCES work_item(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS work_item_counter (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    next_number INTEGER NOT NULL DEFAULT 1
  )`,

  `CREATE INDEX IF NOT EXISTS idx_work_item_sprint ON work_item(sprint_id)`,
  `CREATE INDEX IF NOT EXISTS idx_work_item_status ON work_item(status)`,
  `CREATE INDEX IF NOT EXISTS idx_work_item_parent ON work_item(parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_work_item_activity_item ON work_item_activity(work_item_id)`,

  `CREATE TABLE IF NOT EXISTS supervisor_task (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    capability TEXT NOT NULL,
    workspace_id TEXT,
    assigned_agent_id TEXT,
    assigned_agent_type TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS loop_run (
    id TEXT PRIMARY KEY,
    work_item_id TEXT,
    workflow_execution_id TEXT,
    loop_id TEXT NOT NULL,
    iteration INTEGER NOT NULL DEFAULT 0,
    max_iterations INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'running',
    verdict TEXT,
    loop_status TEXT,
    job_id TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (work_item_id) REFERENCES work_item(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS loop_job (
    id TEXT PRIMARY KEY,
    work_item_id TEXT,
    workflow_id TEXT,
    job_type TEXT NOT NULL DEFAULT 'work_item_pipeline',
    status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    loop_run_id TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (work_item_id) REFERENCES work_item(id) ON DELETE SET NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_supervisor_task_status ON supervisor_task(status)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_run_work_item ON loop_run(work_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_loop_job_status ON loop_job(status)`,
];

/** Initialize SQLite database and run migrations. */
export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const migrate = db.transaction(() => {
    for (const sql of MIGRATIONS) {
      db!.exec(sql);
    }
    const row = db!.prepare('SELECT version FROM schema_version LIMIT 1').get() as
      | { version: number }
      | undefined;
    let version = row?.version ?? 0;
    if (!version) {
      db!.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
      version = 1;
    }

    if (version < 2) {
      const cols = db!.prepare('PRAGMA table_info(work_item)').all() as { name: string }[];
      const names = new Set(cols.map((c) => c.name));
      if (!names.has('loop_iteration')) {
        db!.exec('ALTER TABLE work_item ADD COLUMN loop_iteration INTEGER NOT NULL DEFAULT 0');
      }
      if (!names.has('max_loop_iterations')) {
        db!.exec('ALTER TABLE work_item ADD COLUMN max_loop_iterations INTEGER NOT NULL DEFAULT 3');
      }
      if (!names.has('loop_status')) {
        db!.exec("ALTER TABLE work_item ADD COLUMN loop_status TEXT NOT NULL DEFAULT 'idle'");
      }
      db!.prepare('UPDATE schema_version SET version = ?').run(2);
      version = 2;
    }

    if (version < 3) {
      const execCols = db!.prepare('PRAGMA table_info(workflow_execution)').all() as { name: string }[];
      if (!new Set(execCols.map((c) => c.name)).has('loop_results')) {
        db!.exec('ALTER TABLE workflow_execution ADD COLUMN loop_results TEXT');
      }
      db!.prepare('UPDATE schema_version SET version = ?').run(3);
      version = 3;
    }

    if (version < 4) {
      db!.exec(`CREATE TABLE IF NOT EXISTS supervisor_task (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        capability TEXT NOT NULL,
        workspace_id TEXT,
        assigned_agent_id TEXT,
        assigned_agent_type TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
      db!.exec(`CREATE TABLE IF NOT EXISTS loop_run (
        id TEXT PRIMARY KEY,
        work_item_id TEXT,
        workflow_execution_id TEXT,
        loop_id TEXT NOT NULL,
        iteration INTEGER NOT NULL DEFAULT 0,
        max_iterations INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'running',
        verdict TEXT,
        loop_status TEXT,
        job_id TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      )`);
      db!.exec(`CREATE TABLE IF NOT EXISTS loop_job (
        id TEXT PRIMARY KEY,
        work_item_id TEXT,
        workflow_id TEXT,
        job_type TEXT NOT NULL DEFAULT 'work_item_pipeline',
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL DEFAULT '{}',
        result TEXT,
        error TEXT,
        loop_run_id TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      )`);
      db!.exec('CREATE INDEX IF NOT EXISTS idx_supervisor_task_status ON supervisor_task(status)');
      db!.exec('CREATE INDEX IF NOT EXISTS idx_loop_run_work_item ON loop_run(work_item_id)');
      db!.exec('CREATE INDEX IF NOT EXISTS idx_loop_job_status ON loop_job(status)');
      db!.prepare('UPDATE schema_version SET version = ?').run(4);
      version = 4;
    }

    if (version < 5) {
      const auditCols = db!.prepare('PRAGMA table_info(audit_log)').all() as { name: string }[];
      const auditNames = new Set(auditCols.map((c) => c.name));
      if (!auditNames.has('work_item_id')) {
        db!.exec('ALTER TABLE audit_log ADD COLUMN work_item_id TEXT');
      }
      if (!auditNames.has('loop_iteration')) {
        db!.exec('ALTER TABLE audit_log ADD COLUMN loop_iteration INTEGER');
      }
      if (!auditNames.has('pipeline_phase')) {
        db!.exec('ALTER TABLE audit_log ADD COLUMN pipeline_phase TEXT');
      }
      if (!auditNames.has('agent_type')) {
        db!.exec('ALTER TABLE audit_log ADD COLUMN agent_type TEXT');
      }
      db!.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_work_item ON audit_log(work_item_id)');

      const approvalCols = db!.prepare('PRAGMA table_info(approval_request)').all() as { name: string }[];
      const approvalNames = new Set(approvalCols.map((c) => c.name));
      if (!approvalNames.has('work_item_id')) {
        db!.exec('ALTER TABLE approval_request ADD COLUMN work_item_id TEXT');
      }
      if (!approvalNames.has('loop_run_id')) {
        db!.exec('ALTER TABLE approval_request ADD COLUMN loop_run_id TEXT');
      }
      if (!approvalNames.has('summary')) {
        db!.exec('ALTER TABLE approval_request ADD COLUMN summary TEXT');
      }
      db!.prepare('UPDATE schema_version SET version = ?').run(5);
      version = 5;
    }

    if (version < 6) {
      const jobCols = db!.prepare('PRAGMA table_info(loop_job)').all() as { name: string }[];
      if (!new Set(jobCols.map((c) => c.name)).has('worker_pid')) {
        db!.exec('ALTER TABLE loop_job ADD COLUMN worker_pid INTEGER');
      }
      db!.prepare('UPDATE schema_version SET version = ?').run(6);
      version = 6;
    }

    if (version < 7) {
      db!.exec(`CREATE TABLE IF NOT EXISTS agent_employment (
        agent_id TEXT PRIMARY KEY,
        display_title TEXT,
        role TEXT NOT NULL,
        employment_status TEXT NOT NULL DEFAULT 'active',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        working_hours TEXT NOT NULL DEFAULT '[]',
        hired_at TEXT NOT NULL,
        notes TEXT,
        FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE
      )`);
      db!.exec(`CREATE TABLE IF NOT EXISTS sprint_team_member (
        id TEXT PRIMARY KEY,
        sprint_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        automation_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sprint_id) REFERENCES sprint(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE CASCADE,
        UNIQUE(sprint_id, role)
      )`);
      db!.exec(`CREATE TABLE IF NOT EXISTS sprint_automation (
        sprint_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'paused',
        last_tick_at TEXT,
        paused_reason TEXT,
        active_queue_id TEXT,
        FOREIGN KEY (sprint_id) REFERENCES sprint(id) ON DELETE CASCADE
      )`);
      db!.exec('CREATE INDEX IF NOT EXISTS idx_sprint_team_agent ON sprint_team_member(agent_id)');
      const jobCols = db!.prepare('PRAGMA table_info(loop_job)').all() as { name: string }[];
      const jobNames = new Set(jobCols.map((c) => c.name));
      if (!jobNames.has('sprint_id')) {
        db!.exec('ALTER TABLE loop_job ADD COLUMN sprint_id TEXT');
      }
      if (!jobNames.has('assigned_agent_id')) {
        db!.exec('ALTER TABLE loop_job ADD COLUMN assigned_agent_id TEXT');
      }
      if (!jobNames.has('scheduled_for')) {
        db!.exec('ALTER TABLE loop_job ADD COLUMN scheduled_for TEXT');
      }
      db!.prepare('UPDATE schema_version SET version = ?').run(7);
      version = 7;
    }

    if (version < 8) {
      const empCols = db!.prepare('PRAGMA table_info(agent_employment)').all() as { name: string }[];
      const empNames = new Set(empCols.map((c) => c.name));
      if (!empNames.has('profile_description')) {
        db!.exec('ALTER TABLE agent_employment ADD COLUMN profile_description TEXT');
      }
      if (!empNames.has('skills')) {
        db!.exec("ALTER TABLE agent_employment ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'");
      }
      if (!empNames.has('custom_role_label')) {
        db!.exec('ALTER TABLE agent_employment ADD COLUMN custom_role_label TEXT');
      }
      db!.prepare('UPDATE schema_version SET version = ?').run(8);
      version = 8;
    }

    if (version < 9) {
      db!.exec(`CREATE TABLE IF NOT EXISTS log_event (
        id TEXT PRIMARY KEY,
        agent_id TEXT,
        agent_type TEXT,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        source TEXT,
        work_item_id TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agent(id) ON DELETE SET NULL
      )`);
      db!.exec('CREATE INDEX IF NOT EXISTS idx_log_event_agent_id ON log_event(agent_id)');
      db!.exec('CREATE INDEX IF NOT EXISTS idx_log_event_severity ON log_event(severity)');
      db!.exec('CREATE INDEX IF NOT EXISTS idx_log_event_created_at ON log_event(created_at)');
      db!.exec('CREATE INDEX IF NOT EXISTS idx_log_event_work_item ON log_event(work_item_id)');
      db!.prepare('UPDATE schema_version SET version = ?').run(9);
    }
  });

  migrate();
  return db;
}

/** Get the active database connection. */
export function getDatabase(): Database.Database {
  if (!db) return initDatabase();
  return db;
}

/** Check database connectivity. */
export function isDatabaseHealthy(): boolean {
  try {
    getDatabase().prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

/** Close the database connection. */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}