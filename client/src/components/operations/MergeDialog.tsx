import { useState } from 'react';
import { X, GitMerge, Loader2, AlertTriangle, ChevronDown, Trash2 } from 'lucide-react';
import { useStatusStore } from '../../store/statusStore';
import { useLogStore } from '../../store/logStore';
import { useToastStore } from '../../store/toastStore';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface MergeDialogProps {
  repoPath: string;
  preselectedBranch?: string;
  mode?: 'from' | 'to';
  onClose: () => void;
}

export function MergeDialog({ repoPath, preselectedBranch, mode = 'from', onClose }: MergeDialogProps) {
  const { status, branches, loadedRepo, fetchAll } = useStatusStore();
  const fetchLog = useLogStore(s => s.fetchLog);
  const addToast = useToastStore(s => s.addToast);

  const mergeTo = mode === 'to';
  const [currentBranch] = useState(() => loadedRepo === repoPath ? status?.current || 'HEAD' : 'HEAD');
  const localBranches = branches
    .filter(b => !b.isRemote && b.name !== currentBranch)
    .map(b => b.name);

  const [selectedBranch, setSelectedBranch] = useState(preselectedBranch || (mergeTo && localBranches.find(b => b === 'main' || b === 'master')) || localBranches[0] || '');
  const sourceBranch = mergeTo ? currentBranch : selectedBranch;
  const targetBranch = mergeTo ? selectedBranch : currentBranch;
  const [deleteBranchAfter, setDeleteBranchAfter] = useState(false);
  const [merging, setMerging] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleMerge = async () => {
    if (!selectedBranch || merging || conflicts) return;
    setMerging(true);
    setError('');
    setConflicts(null);
    try {
      const result = mergeTo
        ? await api.mergeToBranch(repoPath, sourceBranch, targetBranch)
        : await api.mergeBranch(repoPath, sourceBranch);
      if (result.merged) {
        addToast('success', result.message);
        if (deleteBranchAfter) {
          try {
            await api.deleteBranch(repoPath, sourceBranch);
            addToast('info', `Deleted branch ${sourceBranch}`);
          } catch (err: any) {
            addToast('error', `Merge succeeded but failed to delete branch: ${err.message}`);
          }
        }
        onClose();
      } else {
        setConflicts(result.conflicts || []);
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || 'Merge failed');
    } finally {
      void fetchLog(repoPath);
      void fetchAll(repoPath);
      setMerging(false);
    }
  };

  const handleAbort = async () => {
    setAborting(true);
    try {
      await api.mergeAbort(repoPath);
      addToast('info', 'Merge aborted');
      setConflicts(null);
      setError('');
      void fetchAll(repoPath);
      void fetchLog(repoPath);
      if (mergeTo) onClose();
    } catch (err: any) {
      addToast('error', err.message || 'Failed to abort merge');
    } finally {
      setAborting(false);
    }
  };

  const busy = merging || aborting;
  const closeDialog = () => { if (!busy) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={closeDialog}>
      <div
        className="app-dialog bg-bg-secondary border border-border rounded-lg w-[440px] shadow-xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <GitMerge size={16} className="text-accent" />
            <span className="text-sm font-medium">{mergeTo ? 'Merge To…' : 'Merge Branch'}</span>
          </div>
          <button
            onClick={closeDialog}
            disabled={busy}
            aria-label="Close merge dialog"
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Branch selector */}
          <div>
            <label className="block text-xs text-text-secondary mb-1.5 font-medium">{mergeTo ? 'Merge into' : 'Merge from'}</label>
            <div className="relative">
              <button
                aria-label={mergeTo ? 'Destination branch' : 'Source branch'}
                disabled={busy || conflicts !== null}
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="w-full flex items-center justify-between bg-bg-primary border border-border rounded px-3 py-2 text-xs text-text-primary hover:border-accent/50 transition-colors"
              >
                <span className={selectedBranch ? '' : 'text-text-muted'}>
                  {selectedBranch || 'Select branch...'}
                </span>
                <ChevronDown size={12} className="text-text-muted" />
              </button>
              {dropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-bg-secondary border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {localBranches.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-muted">No other branches</div>
                  ) : (
                    localBranches.map(b => (
                      <button
                        key={b}
                        onClick={() => { setSelectedBranch(b); setDropdownOpen(false); }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-xs hover:bg-bg-tertiary transition-colors',
                          b === selectedBranch ? 'bg-accent/10 text-accent' : 'text-text-primary'
                        )}
                      >
                        {b}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Preview */}
          {selectedBranch && (
            <div className="flex flex-wrap items-center gap-2 text-xs break-all">
              <span className="px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/20 font-medium">
                {sourceBranch}
              </span>
              <GitMerge size={12} className="text-text-muted" />
              <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 font-medium">
                {targetBranch}
              </span>
            </div>
          )}

          {mergeTo && <p className="text-xs text-text-secondary">
            Switches to {targetBranch || 'the destination branch'} and merges {sourceBranch} into it.
            You will stay on the destination branch, including if there are conflicts or you abort.
            Commit or stash local changes first. This does not push to the remote.
          </p>}

          {/* Delete branch checkbox */}
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              disabled={busy || conflicts !== null}
              checked={deleteBranchAfter}
              onChange={e => setDeleteBranchAfter(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-border bg-bg-primary accent-accent cursor-pointer"
            />
            <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors flex items-center gap-1">
              <Trash2 size={10} />
              Delete source branch after merge
            </span>
          </label>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-danger/10 border border-danger/20">
              <AlertTriangle size={14} className="text-danger flex-shrink-0 mt-0.5" />
              <div className="text-xs text-danger">{error}</div>
            </div>
          )}

          {/* Conflicts list */}
          {conflicts && conflicts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-text-secondary font-medium">Conflicted files:</p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {conflicts.map(f => (
                  <div key={f} className="text-[0.65rem] font-mono text-danger px-2 py-1 rounded bg-danger/5">
                    {f}
                  </div>
                ))}
              </div>
              <p className="text-[0.65rem] text-text-muted">
                Resolve conflicts manually, then commit. Or abort the merge.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
          {conflicts ? (
            <button
              onClick={handleAbort}
              disabled={aborting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-danger hover:bg-danger/80 text-white disabled:opacity-40 transition-colors"
            >
              {aborting ? <Loader2 size={12} className="animate-spin" /> : null}
              Abort Merge
            </button>
          ) : (
            <>
              <button
                onClick={closeDialog}
                className="px-3 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!selectedBranch || busy || (mergeTo && currentBranch === 'HEAD')}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-accent-emphasis hover:bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {merging ? (
                  <><Loader2 size={12} className="animate-spin" /> Merging...</>
                ) : (
                  <><GitMerge size={12} /> {mergeTo ? 'Merge To' : 'Merge'}</>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
