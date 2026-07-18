import { Router, Request, Response } from 'express';
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  updateWorkspace,
  deleteWorkspace,
  addRepository,
  listRepositories,
  removeRepository,
  setPrimaryRepository,
} from '../modules/workspace';
import { validateProjectDirectory } from '../modules/fs-browse';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(listWorkspaces());
});

router.post('/', (req: Request, res: Response) => {
  const { name, description, config } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ message: 'name is required' });
    return;
  }
  const workspace = createWorkspace(name, description, config);
  res.status(201).json(workspace);
});

router.get('/:id', (req: Request, res: Response) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) {
    res.status(404).json({ message: 'Workspace not found' });
    return;
  }
  res.json(workspace);
});

router.put('/:id', (req: Request, res: Response) => {
  const workspace = updateWorkspace(req.params.id, req.body);
  if (!workspace) {
    res.status(404).json({ message: 'Workspace not found' });
    return;
  }
  res.json(workspace);
});

router.delete('/:id', (req: Request, res: Response) => {
  if (!deleteWorkspace(req.params.id)) {
    res.status(404).json({ message: 'Workspace not found' });
    return;
  }
  res.status(204).send();
});

router.get('/:id/repositories', (req: Request, res: Response) => {
  if (!getWorkspace(req.params.id)) {
    res.status(404).json({ message: 'Workspace not found' });
    return;
  }
  res.json(listRepositories(req.params.id));
});

router.post('/:id/repositories', (req: Request, res: Response) => {
  const { name, path: repoPath, remoteUrl, metadata, setPrimary } = req.body as {
    name?: string;
    path?: string;
    remoteUrl?: string;
    metadata?: Record<string, unknown>;
    setPrimary?: boolean;
  };

  if (!repoPath) {
    res.status(400).json({ message: 'path is required' });
    return;
  }

  const validation = validateProjectDirectory(repoPath);
  if (!validation.valid) {
    res.status(400).json({ message: validation.message ?? 'Invalid project path' });
    return;
  }

  const repoName = (name?.trim() || validation.name).trim();
  if (!repoName) {
    res.status(400).json({ message: 'name is required' });
    return;
  }

  const workspace = getWorkspace(req.params.id);
  if (!workspace) {
    res.status(404).json({ message: 'Workspace not found' });
    return;
  }

  const repo = addRepository(
    req.params.id,
    repoName,
    validation.path,
    remoteUrl,
    { ...(metadata ?? {}), isGitRepo: validation.isGitRepo }
  );
  if (!repo) {
    res.status(404).json({ message: 'Workspace not found' });
    return;
  }

  const existingRepos = listRepositories(req.params.id);
  if (setPrimary || existingRepos.length === 1) {
    setPrimaryRepository(req.params.id, repo.id);
  }

  res.status(201).json(repo);
});

router.patch('/:id/primary-repository', (req: Request, res: Response) => {
  const { repoId } = req.body as { repoId?: string };
  if (!repoId) {
    res.status(400).json({ message: 'repoId is required' });
    return;
  }

  const workspace = setPrimaryRepository(req.params.id, repoId);
  if (!workspace) {
    res.status(404).json({ message: 'Workspace or repository not found' });
    return;
  }

  res.json(workspace);
});

router.delete('/:id/repositories/:repoId', (req: Request, res: Response) => {
  if (!removeRepository(req.params.id, req.params.repoId)) {
    res.status(404).json({ message: 'Repository not found in this workspace' });
    return;
  }
  res.status(204).send();
});

export default router;