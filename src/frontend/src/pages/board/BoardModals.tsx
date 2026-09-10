import type { ReactNode } from 'react';
import { AGENT_ROLE_LABELS, STAFF_ROLES } from '../../constants/agent-roles';
import Modal from '../../components/Modal';
import type { AgentRole, RosterAgent, Sprint, SprintTeamView, WorkItem } from '../../types';

interface BoardModalsProps {
  staffOpen: boolean;
  onCloseStaff: () => void;
  roster?: RosterAgent[];
  staffDraft: Record<AgentRole, string>;
  onStaffDraftChange: (role: AgentRole, agentId: string) => void;
  staffError: string | null;
  sprintTeam?: SprintTeamView;
  onSaveTeam: () => void;
  saveTeamPending: boolean;
  createOpen: boolean;
  onCloseCreate: () => void;
  editItem: WorkItem | null;
  onCloseEdit: () => void;
  itemForm: ReactNode;
  deleteTarget: WorkItem | null;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  deletePending: boolean;
  sprintCreateOpen: boolean;
  onCloseSprintCreate: () => void;
  sprintEditOpen: boolean;
  onCloseSprintEdit: () => void;
  currentSprint?: Sprint;
  sprintForm: ReactNode;
  sprintDeleteOpen: boolean;
  onCloseSprintDelete: () => void;
  onConfirmSprintDelete: () => void;
  sprintDeletePending: boolean;
}

export default function BoardModals(props: BoardModalsProps) {
  const {
    staffOpen,
    onCloseStaff,
    roster,
    staffDraft,
    onStaffDraftChange,
    staffError,
    sprintTeam,
    onSaveTeam,
    saveTeamPending,
    createOpen,
    onCloseCreate,
    editItem,
    onCloseEdit,
    itemForm,
    deleteTarget,
    onCloseDelete,
    onConfirmDelete,
    deletePending,
    sprintCreateOpen,
    onCloseSprintCreate,
    sprintEditOpen,
    onCloseSprintEdit,
    currentSprint,
    sprintForm,
    sprintDeleteOpen,
    onCloseSprintDelete,
    onConfirmSprintDelete,
    sprintDeletePending,
  } = props;

  return (
    <>
      <Modal id="modal-staff-team" open={staffOpen} title="Staff sprint team" onClose={onCloseStaff}>
        <div className="form-stack">
          {!roster?.length ? (
            <p className="text-muted">Hire agents on the Agents page first.</p>
          ) : (
            STAFF_ROLES.map((role) => (
              <label key={role}>
                {AGENT_ROLE_LABELS[role]}
                <select
                  className="input"
                  value={staffDraft[role]}
                  onChange={(e) => onStaffDraftChange(role, e.target.value)}
                >
                  <option value="">— Unassigned —</option>
                  {roster.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.employment?.displayTitle ?? r.name} ({r.employment?.role})
                      {r.onShift ? ' · on shift' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))
          )}
          {staffError ? (
            <p className="form-error">{staffError}</p>
          ) : sprintTeam?.conflicts.length ? (
            <p className="text-muted" style={{ color: 'var(--color-warning)' }}>
              Conflicts: {sprintTeam.conflicts.join('; ')}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn btn--ghost" onClick={onCloseStaff}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onSaveTeam}
              disabled={saveTeamPending || !roster?.length}
            >
              Save team
            </button>
          </div>
        </div>
      </Modal>

      <Modal id="modal-create-work-item" open={createOpen} onClose={onCloseCreate} title="Create work item">
        {itemForm}
      </Modal>

      <Modal
        id="modal-edit-work-item"
        open={!!editItem}
        onClose={onCloseEdit}
        title={editItem ? `Edit ${editItem.key}` : 'Edit work item'}
      >
        {editItem && itemForm}
      </Modal>

      <Modal id="modal-delete-work-item" open={!!deleteTarget} onClose={onCloseDelete} title="Delete work item">
        {deleteTarget && (
          <div className="form-stack">
            <p>
              Delete <strong>{deleteTarget.key}</strong> — {deleteTarget.title}? This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={onCloseDelete}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={onConfirmDelete}
                disabled={deletePending}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal id="modal-create-sprint" open={sprintCreateOpen} onClose={onCloseSprintCreate} title="Create sprint">
        {sprintForm}
      </Modal>

      <Modal
        id="modal-edit-sprint"
        open={sprintEditOpen}
        onClose={onCloseSprintEdit}
        title={currentSprint ? `Edit sprint · ${currentSprint.name}` : 'Edit sprint'}
      >
        {currentSprint && sprintForm}
      </Modal>

      <Modal id="modal-delete-sprint" open={sprintDeleteOpen} onClose={onCloseSprintDelete} title="Delete sprint">
        {currentSprint && (
          <div className="form-stack">
            <p>
              Delete sprint <strong>{currentSprint.name}</strong>? Work items stay on the board but are unassigned
              from this sprint. This cannot be undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn--ghost" onClick={onCloseSprintDelete}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={onConfirmSprintDelete}
                disabled={sprintDeletePending}
              >
                {sprintDeletePending ? 'Deleting…' : 'Delete sprint'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
