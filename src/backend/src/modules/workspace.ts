import { getDatabase } from '../database';
import type { Workspace, Repository } from '../types';
import { generateId, now, parseJson } from '../utils/helpers';

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  config: string;
  created_at: string;
  updated_at: string;
}

interface RepositoryRow {
  id: string;
  workspace_id: string;
  name: string;
  path: string;
  remote_url: string | null;
  metadata: string;
  created_at: string;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    config: parseJson(row.config, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    path: row.path,
    remoteUrl: row.remote_url ?? undefined,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
  };
}

/** Create a new workspace. */
export function createWorkspace(
  name: string,
  description?: string,
  config: Record<string, unknown> = {}
): Workspace {
  const db = getDatabase();
  const id = generateId();
  const timestamp = now();

  db.prepare(
    `INSERT INTO workspace (id, name, description, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, description ?? null, JSON.stringify(config), timestamp, timestamp);

  return { id, name, description, config, createdAt: timestamp, updatedAt: timestamp };
}

/** List all workspaces. */
export function listWorkspaces(): Workspace[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM workspace ORDER BY created_at DESC')
    .all() as WorkspaceRow[];
  return rows.map(mapWorkspace);
}

/** Get a workspace by ID. */
export function getWorkspace(id: string): Workspace | null {
  const row = getDatabase()
    .prepare('SELECT * FROM workspace WHERE id = ?')
    .get(id) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : null;
}

/** Update a workspace. */
export function updateWorkspace(
  id: string,
  updates: Partial<Pick<Workspace, 'name' | 'description' | 'config'>>
): Workspace | null {
  const existing = getWorkspace(id);
  if (!existing) return null;

  const name = updates.name ?? existing.name;
  const description = updates.description ?? existing.description;
  const config = updates.config ?? existing.config;
  const timestamp = now();

  getDatabase()
    .prepare('UPDATE workspace SET name = ?, description = ?, config = ?, updated_at = ? WHERE id = ?')
    .run(name, description ?? null, JSON.stringify(config), timestamp, id);

  return { ...existing, name, description, config, updatedAt: timestamp };
}

/** Delete a workspace and its repositories. */
export function deleteWorkspace(id: string): boolean {
  const result = getDatabase().prepare('DELETE FROM workspace WHERE id = ?').run(id);
  return result.changes > 0;
}

/** Add a repository to a workspace. */
export function addRepository(
  workspaceId: string,
  name: string,
  path: string,
  remoteUrl?: string,
  metadata: Record<string, unknown> = {}
): Repository | null {
  if (!getWorkspace(workspaceId)) return null;

  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      `INSERT INTO repository (id, workspace_id, name, path, remote_url, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, workspaceId, name, path, remoteUrl ?? null, JSON.stringify(metadata), timestamp);

  return { id, workspaceId, name, path, remoteUrl, metadata, createdAt: timestamp };
}

/** List repositories for a workspace. */
export function listRepositories(workspaceId: string): Repository[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM repository WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as RepositoryRow[];
  return rows.map(mapRepository);
}

/** Remove a repository from a workspace (and reassign primary if needed). */
export function removeRepository(workspaceId: string, repoId: string): boolean {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return false;

  const repos = listRepositories(workspaceId);
  if (!repos.some((repo) => repo.id === repoId)) return false;

  const result = getDatabase()
    .prepare('DELETE FROM repository WHERE id = ? AND workspace_id = ?')
    .run(repoId, workspaceId);
  if (result.changes === 0) return false;

  const primaryId = workspace.config.primaryRepoId;
  if (primaryId === repoId) {
    const remaining = listRepositories(workspaceId);
    updateWorkspace(workspaceId, {
      config: {
        ...workspace.config,
        primaryRepoId: remaining[0]?.id ?? null,
      },
    });
  }

  return true;
}

/** Mark a repository as the primary project folder for agent context. */
export function setPrimaryRepository(workspaceId: string, repoId: string): Workspace | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const repos = listRepositories(workspaceId);
  if (!repos.some((repo) => repo.id === repoId)) return null;

  return updateWorkspace(workspaceId, {
    config: { ...workspace.config, primaryRepoId: repoId },
  });
}

/** Resolve the primary repository for a workspace, if configured. */
export function getPrimaryRepository(workspaceId: string): Repository | null {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;

  const repos = listRepositories(workspaceId);
  if (repos.length === 0) return null;

  const primaryId = workspace.config.primaryRepoId;
  if (typeof primaryId === 'string') {
    return repos.find((repo) => repo.id === primaryId) ?? repos[0];
  }

  return repos[0];
}