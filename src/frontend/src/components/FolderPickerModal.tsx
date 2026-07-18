import { useEffect, useState } from 'react';
import { ChevronUp, Folder, FolderGit2, Home, Loader2 } from 'lucide-react';
import { useBrowseFolder } from '../api/hooks';
import Modal from './Modal';

interface FolderPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string, name: string, isGitRepo: boolean) => void;
  title?: string;
}

function pathSegments(currentPath: string): { label: string; path: string }[] {
  const parts = currentPath.split('/').filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: `/${parts.slice(0, index + 1).join('/')}`,
  }));
}

export default function FolderPickerModal({
  open,
  onClose,
  onSelect,
  title = 'Select project folder',
}: FolderPickerModalProps) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);
  const [manualPath, setManualPath] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useBrowseFolder(currentPath, open);

  useEffect(() => {
    if (!open) return;
    setCurrentPath(undefined);
    setManualPath('');
  }, [open]);

  useEffect(() => {
    if (data?.path) {
      setManualPath(data.path);
    }
  }, [data?.path]);

  const handleManualBrowse = async () => {
    if (!manualPath.trim()) return;
    setCurrentPath(manualPath.trim());
    await refetch();
  };

  const segments = data ? pathSegments(data.path) : [];

  return (
    <Modal id="modal-folder-picker" open={open} onClose={onClose} title={title}>
      <div className="folder-picker">
        <p className="folder-picker-hint">
          Choose the repo or project directory agents should use for context and file edits.
        </p>

        <div className="folder-picker-path-row">
          <input
            className="input"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            placeholder="~/Documents/GitHub/MyProject"
            onKeyDown={(e) => e.key === 'Enter' && handleManualBrowse()}
          />
          <button type="button" className="btn btn--secondary" onClick={handleManualBrowse} disabled={isFetching}>
            Go
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            title="Browse home directory"
            onClick={() => setCurrentPath(undefined)}
          >
            <Home size={16} />
          </button>
        </div>

        {data?.parent && (
          <button
            type="button"
            className="folder-picker-up"
            onClick={() => setCurrentPath(data.parent!)}
          >
            <ChevronUp size={14} /> Up to parent
          </button>
        )}

        <div className="folder-picker-breadcrumbs">
          {segments.map((segment, index) => (
            <button
              key={`${segment.path}-${index}`}
              type="button"
              className="folder-picker-crumb"
              onClick={() => setCurrentPath(segment.path)}
            >
              {segment.label}
            </button>
          ))}
        </div>

        <div className="folder-picker-list">
          {isLoading || isFetching ? (
            <p className="folder-picker-status">
              <Loader2 size={16} className="spin" /> Loading folders...
            </p>
          ) : isError ? (
            <p className="folder-picker-error">{(error as Error)?.message ?? 'Failed to browse folder'}</p>
          ) : data?.entries.length === 0 ? (
            <p className="folder-picker-status text-muted">No subfolders here.</p>
          ) : (
            data?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="folder-picker-entry"
                onClick={() => setCurrentPath(entry.path)}
              >
                {entry.isGitRepo ? <FolderGit2 size={16} /> : <Folder size={16} />}
                <span className="folder-picker-entry-name">{entry.name}</span>
                {entry.isGitRepo && <span className="folder-picker-git-badge">git</span>}
              </button>
            ))
          )}
        </div>

        {data && (
          <div className="folder-picker-footer">
            <div className="folder-picker-current">
              <strong>Current:</strong> <code>{data.path}</code>
              {data.isGitRepo && <span className="folder-picker-git-badge">git repo</span>}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onSelect(data.path, data.path.split('/').filter(Boolean).pop() ?? data.path, data.isGitRepo)}
              >
                Use this folder
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}