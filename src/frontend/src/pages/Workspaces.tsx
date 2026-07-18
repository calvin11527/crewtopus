import { useMemo, useState } from 'react';
import { FolderKanban, Plus, Trash2, FolderGit2, FolderOpen, Star, AlertTriangle } from 'lucide-react';
import {
  useWorkspaces,
  useCreateWorkspace,
  useDeleteWorkspace,
  useRepositories,
  useAddRepository,
  useSetPrimaryRepository,
  useRemoveRepository,
} from '../api/hooks';
import type { Repository } from '../types';
import Modal from '../components/Modal';
import FolderPickerModal from '../components/FolderPickerModal';

interface RemoveFolderTarget {
  repo: Repository;
  isPrimary: boolean;
}

export default function Workspaces() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const createWs = useCreateWorkspace();
  const deleteWs = useDeleteWorkspace();
  const [modalOpen, setModalOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [removeTarget, setRemoveTarget] = useState<RemoveFolderTarget | null>(null);
  const [confirmWorkspaceName, setConfirmWorkspaceName] = useState('');
  const [removeError, setRemoveError] = useState<string | null>(null);

  const { data: repos } = useRepositories(selectedId || '');
  const addRepo = useAddRepository(selectedId || '');
  const setPrimary = useSetPrimaryRepository(selectedId || '');
  const removeRepo = useRemoveRepository(selectedId || '');

  const selectedWorkspace = useMemo(
    () => workspaces?.find((ws) => ws.id === selectedId),
    [workspaces, selectedId]
  );

  const primaryRepoId =
    typeof selectedWorkspace?.config?.primaryRepoId === 'string'
      ? selectedWorkspace.config.primaryRepoId
      : repos?.[0]?.id;

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createWs.mutateAsync({ name, description: description || undefined });
    setName('');
    setDescription('');
    setModalOpen(false);
  };

  const handleSelectFolder = async (path: string, folderName: string) => {
    if (!selectedId) return;
    await addRepo.mutateAsync({ path, name: folderName, setPrimary: true });
    setPickerOpen(false);
  };

  const openRemoveFolder = (repo: Repository, isPrimary: boolean) => {
    setRemoveError(null);
    setConfirmWorkspaceName('');
    setRemoveTarget({ repo, isPrimary });
  };

  const closeRemoveFolder = () => {
    setRemoveTarget(null);
    setConfirmWorkspaceName('');
    setRemoveError(null);
  };

  const handleConfirmRemoveFolder = async () => {
    if (!removeTarget || !selectedId || !selectedWorkspace) return;

    if (removeTarget.isPrimary) {
      if (confirmWorkspaceName.trim() !== selectedWorkspace.name) {
        setRemoveError(`Type “${selectedWorkspace.name}” exactly to confirm.`);
        return;
      }
    }

    try {
      setRemoveError(null);
      await removeRepo.mutateAsync(removeTarget.repo.id);
      closeRemoveFolder();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : 'Failed to remove folder');
    }
  };

  const primaryConfirmReady =
    !!removeTarget?.isPrimary &&
    !!selectedWorkspace &&
    confirmWorkspaceName.trim() === selectedWorkspace.name;

  return (
    <div id="page-workspaces" className="page page--wide">
      <header className="page-header page-header--row">
        <div>
          <h2>Workspaces</h2>
          <p className="page-subtitle">
            Link a project folder so agents know which repo to read and edit
          </p>
        </div>
        <button id="btn-create-workspace" type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          <Plus size={16} /> Create Workspace
        </button>
      </header>

      {isLoading ? (
        <p className="loading-text">Loading workspaces...</p>
      ) : workspaces?.length === 0 ? (
        <div className="card empty-state">
          <FolderKanban size={40} className="empty-icon" />
          <p>No workspaces yet. Create one, then link a project folder.</p>
        </div>
      ) : (
        <div className="workspace-grid">
          <div className="workspace-list">
            {workspaces?.map((ws) => (
              <div
                key={ws.id}
                id={`workspace-${ws.id}`}
                className={`workspace-item${selectedId === ws.id ? ' workspace-item--active' : ''}`}
                onClick={() => setSelectedId(ws.id)}
              >
                <FolderKanban size={18} />
                <div>
                  <strong>{ws.name}</strong>
                  {ws.description && <p>{ws.description}</p>}
                </div>
                <button
                  id={`workspace-delete-${ws.id}`}
                  type="button"
                  className="btn-icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteWs.mutate(ws.id);
                    if (selectedId === ws.id) setSelectedId(null);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {selectedId && (
            <div id="workspace-detail" className="card workspace-detail-panel">
              <div className="workspace-detail-header">
                <h3>
                  <FolderGit2 size={18} /> Project focus
                </h3>
                <button
                  id="btn-browse-folder"
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => setPickerOpen(true)}
                >
                  <FolderOpen size={14} /> Select folder
                </button>
              </div>

              <p className="workspace-detail-hint">
                Agents on work items assigned to <strong>{selectedWorkspace?.name}</strong> will use the
                primary folder for context files and CLI working directory.
              </p>

              <div className="repo-list">
                {repos?.length === 0 ? (
                  <div className="workspace-empty-repo">
                    <FolderOpen size={28} className="empty-icon" />
                    <p>No project folder linked yet.</p>
                    <button type="button" className="btn btn--secondary" onClick={() => setPickerOpen(true)}>
                      Browse for folder
                    </button>
                  </div>
                ) : (
                  repos?.map((r) => {
                    const isPrimary = r.id === primaryRepoId;
                    const isGit = r.metadata?.isGitRepo === true;
                    return (
                      <div
                        key={r.id}
                        id={`repo-${r.id}`}
                        className={`repo-item${isPrimary ? ' repo-item--primary' : ''}`}
                      >
                        <div className="repo-item-top">
                          <div>
                            <strong>{r.name}</strong>
                            {isPrimary && <span className="repo-primary-badge">Primary focus</span>}
                            {isGit && <span className="folder-picker-git-badge">git</span>}
                          </div>
                          <div className="repo-item-actions">
                            {!isPrimary && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                title="Set as primary project folder"
                                onClick={() => setPrimary.mutate(r.id)}
                                disabled={setPrimary.isPending || removeRepo.isPending}
                              >
                                <Star size={14} /> Set primary
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm btn--danger"
                              id={`repo-remove-${r.id}`}
                              title={
                                isPrimary
                                  ? 'Remove primary project folder (requires confirmation)'
                                  : 'Remove this folder from the workspace'
                              }
                              onClick={() => openRemoveFolder(r, isPrimary)}
                              disabled={removeRepo.isPending}
                            >
                              <Trash2 size={14} /> Remove
                            </button>
                          </div>
                        </div>
                        <code>{r.path}</code>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <FolderPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectFolder}
        title="Select project folder"
      />

      <Modal id="modal-create-workspace" title="Create Workspace" open={modalOpen} onClose={() => setModalOpen(false)}>
        <div className="form-stack">
          <label htmlFor="input-ws-name">Name</label>
          <input
            id="input-ws-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="AgentHub"
          />
          <label htmlFor="input-ws-desc">Description</label>
          <textarea
            id="input-ws-desc"
            className="input textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            rows={3}
          />
          <button
            id="btn-submit-workspace"
            type="button"
            className="btn btn--primary"
            onClick={handleCreate}
            disabled={createWs.isPending}
          >
            {createWs.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </Modal>

      <Modal
        id="modal-remove-folder"
        title={removeTarget?.isPrimary ? 'Remove primary project folder' : 'Remove project folder'}
        open={!!removeTarget}
        onClose={closeRemoveFolder}
      >
        {removeTarget && selectedWorkspace && (
          <div className="form-stack remove-folder-confirm">
            <div className="remove-folder-warning">
              <AlertTriangle size={18} aria-hidden />
              <div>
                {removeTarget.isPrimary ? (
                  <>
                    <p>
                      You are about to remove the <strong>primary focus</strong> folder from{' '}
                      <strong>{selectedWorkspace.name}</strong>. Agents use this path for context and
                      CLI work.
                    </p>
                    <p className="text-muted">
                      This unlinks the folder from the workspace. Files on disk are not deleted.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Remove <strong>{removeTarget.repo.name}</strong> from workspace{' '}
                      <strong>{selectedWorkspace.name}</strong>?
                    </p>
                    <p className="text-muted">
                      This only unlinks the folder. Files on disk are not deleted.
                    </p>
                  </>
                )}
              </div>
            </div>

            <code className="remove-folder-path">{removeTarget.repo.path}</code>

            {removeTarget.isPrimary && (
              <div className="remove-folder-type-confirm">
                <label htmlFor="input-confirm-workspace-name">
                  To confirm, type <strong>{selectedWorkspace.name}</strong> below:
                </label>
                <input
                  id="input-confirm-workspace-name"
                  className="input"
                  value={confirmWorkspaceName}
                  onChange={(e) => {
                    setConfirmWorkspaceName(e.target.value);
                    setRemoveError(null);
                  }}
                  placeholder={selectedWorkspace.name}
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                />
              </div>
            )}

            {removeError && <p className="form-error">{removeError}</p>}

            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={closeRemoveFolder}>
                Cancel
              </button>
              <button
                id="btn-confirm-remove-folder"
                type="button"
                className="btn btn--danger-solid"
                onClick={() => void handleConfirmRemoveFolder()}
                disabled={
                  removeRepo.isPending || (removeTarget.isPrimary && !primaryConfirmReady)
                }
              >
                {removeRepo.isPending
                  ? 'Removing…'
                  : removeTarget.isPrimary
                    ? 'I understand, remove primary folder'
                    : 'Remove folder'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
