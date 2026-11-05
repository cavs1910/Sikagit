import { useState, useRef, useEffect, useMemo } from 'react';
import { GitBranch, GitMerge, Check, ChevronDown, Search, Cloud, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useStatusStore } from '../../store/statusStore';
import { useLogStore } from '../../store/logStore';
import { useToastStore } from '../../store/toastStore';
import { useConfirmStore } from '../../store/confirmStore';
import { BranchCleanupDialog } from '../operations/BranchCleanupDialog';
import { cn } from '../../lib/utils';
import type { GitBranch as GitBranchType } from '@sikagit/shared';

const emptyBranches: GitBranchType[] = [];

// "remotes/origin/feature" -> "origin/feature"
const remoteLabel = (name: string) => name.replace(/^remotes\//, '');

/**
 * Repo-header branch picker: shows the current branch and, on click, a filterable
 * dropdown of all local + remote branches. Selecting one switches to it via the
 * safe /git/switch-branch endpoint (creates a tracking branch for remotes).
 */
export function BranchSwitcher({ repoPath, onMerge, compact = false }: { repoPath: string; onMerge: (mode: 'from' | 'to') => void; compact?: boolean }) {
  const branches = useStatusStore(s => s.loadedRepo === repoPath ? s.branches : emptyBranches);
  const status = useStatusStore(s => s.loadedRepo === repoPath ? s.status : null);
  const ready = useStatusStore(s => s.loadedRepo === repoPath && s.branchesLoaded);
  const loading = useStatusStore(s => s.loading);
  const fetchAll = useStatusStore(s => s.fetchAll);
  const fetchLog = useLogStore(s => s.fetchLog);
  const addToast = useToastStore(s => s.addToast);
  const confirm = useConfirmStore(s => s.confirmWithCheckbox);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const busy = !!switching || !!deleting;
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = status?.current || branches.find(b => b.current)?.name || (ready ? 'HEAD (detached)' : loading ? 'Loading branches…' : 'Branches unavailable');

  const { local, remote } = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (label: string) => !f || label.toLowerCase().includes(f);
    return {
      local: branches.filter(b => !b.isRemote && match(b.name)),
      remote: branches.filter(b => b.isRemote && match(remoteLabel(b.name))),
    };
  }, [branches, filter]);

  // Close on outside click / Escape; focus the filter when opening.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  const switchTo = async (b: GitBranchType) => {
    if (b.current || busy) return;
    setSwitching(b.name);
    try {
      const { branch } = await api.switchBranch(repoPath, b.name);
      addToast('success', `Switched to ${branch}`);
      setOpen(false);
      setFilter('');
      fetchAll(repoPath);
      fetchLog(repoPath);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to switch branch');
    } finally {
      setSwitching(null);
    }
  };

  const removeBranch = async (b: GitBranchType) => {
    if (busy || b.current) return;
    setDeleting(b.name);
    setOpen(false);
    try {
      const label = b.isRemote ? remoteLabel(b.name) : b.name;
      const result = await confirm({
        title: b.isRemote ? 'Delete remote branch?' : 'Delete local branch?',
        message: b.isRemote
          ? `Delete "${label}" from the remote server? This affects other clones. Local branches will be kept.\n\nIf it changed since the last Fetch, deletion will be refused. Fetch and review it before retrying.`
          : `Delete local branch "${label}"? Remote branches will be kept. Git will refuse if the branch is not fully merged unless you explicitly force deletion.`,
        confirmLabel: b.isRemote ? 'Delete remote branch' : 'Delete local branch',
        variant: 'danger',
        checkbox: b.isRemote ? undefined : { label: 'Force delete, even with unmerged commits', defaultChecked: false },
      });
      if (!result.confirmed) return;
      if (b.isRemote) {
        const outcome = await api.deleteRemoteBranch(repoPath, b.name, b.commit);
        addToast('success', outcome.message);
      } else {
        await api.deleteBranch(repoPath, b.name, !!result.checkboxValue, b.commit);
        addToast('success', `Deleted local branch ${b.name}`);
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to delete branch');
    } finally {
      // Refresh after errors as well: a remote may have changed independently.
      void fetchAll(repoPath);
      void fetchLog(repoPath);
      setDeleting(null);
    }
  };

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={!ready || busy}
        title={`Current branch: ${current} — click to switch`}
        aria-expanded={open}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border bg-bg-primary transition-colors disabled:opacity-60',
          compact ? 'max-w-[40vw]' : 'max-w-[220px]',
          open
            ? 'border-accent/50 text-text-primary'
            : 'border-border text-text-secondary hover:text-text-primary hover:border-accent/40'
        )}
      >
        {(!ready && loading) || busy ? <Loader2 size={12} className="animate-spin flex-shrink-0" /> : <GitBranch size={12} className="text-accent flex-shrink-0" />}
        <span className="truncate font-medium">{current}</span>
        <ChevronDown size={12} className="text-text-muted flex-shrink-0" />
      </button>

      {open && (
        <div className="branch-menu absolute left-0 top-full mt-1 z-40 w-[280px] bg-bg-primary border border-border rounded-md shadow-lg flex flex-col overflow-hidden max-h-[380px]">
          {/* Filter */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border flex-shrink-0">
            <Search size={12} className="text-text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filter branches…"
              className="flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Available branches">
            <div className="px-3 py-1 text-[0.6rem] uppercase tracking-wider text-text-muted">Local</div>
            {local.length === 0 ? (
              <p className="px-3 py-1 text-[0.7rem] text-text-muted">No matching branches</p>
            ) : (
              local.map(b => (
                <BranchRow
                  key={b.name}
                  label={b.name}
                  active={b.current}
                  busy={switching === b.name}
                  disabled={busy}
                  onClick={() => switchTo(b)}
                  onDelete={() => void removeBranch(b)}
                />
              ))
            )}

            {remote.length > 0 && (
              <>
                <div className="px-3 py-1 mt-1 text-[0.6rem] uppercase tracking-wider text-text-muted border-t border-border/60">Remote</div>
                {remote.map(b => (
                  <BranchRow
                    key={b.name}
                    label={remoteLabel(b.name)}
                    remote
                    busy={switching === b.name}
                    disabled={busy}
                    onClick={() => switchTo(b)}
                    onDelete={b.name.endsWith('/HEAD') ? undefined : () => void removeBranch(b)}
                  />
                ))}
              </>
            )}
          </div>
          <div className="shrink-0 border-t border-border p-2 bg-bg-secondary">
            <button
              type="button" disabled={busy}
              onClick={() => { setOpen(false); setCleanupOpen(true); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-text-secondary hover:bg-bg-tertiary disabled:opacity-40"
            ><Trash2 size={14} className="shrink-0" />Clean up merged branches…</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setOpen(false); setFilter(''); onMerge('from'); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              <GitMerge size={14} className="shrink-0" />
              Merge…
            </button>
            <button
              type="button"
              disabled={busy || !branches.some(b => b.current && !b.isRemote) || !branches.some(b => !b.current && !b.isRemote)}
              onClick={() => { setOpen(false); setFilter(''); onMerge('to'); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              <GitMerge size={14} className="shrink-0" />
              Merge To…
            </button>
          </div>
        </div>
      )}
      {cleanupOpen && <BranchCleanupDialog repoPath={repoPath} onClose={() => setCleanupOpen(false)} />}
    </div>
  );
}

function BranchRow({ label, active, remote, busy, disabled, onClick, onDelete }: {
  label: string;
  active?: boolean;
  remote?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center">
    <button
      onClick={onClick}
      disabled={active || busy || disabled}
      className={cn(
        'min-w-0 flex-1 flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
        active
          ? 'text-accent cursor-default'
          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
      )}
    >
      {busy ? (
        <Loader2 size={12} className="animate-spin flex-shrink-0" />
      ) : active ? (
        <Check size={12} className="text-accent flex-shrink-0" />
      ) : remote ? (
        <Cloud size={12} className="text-text-muted flex-shrink-0" />
      ) : (
        <GitBranch size={12} className="text-text-muted flex-shrink-0" />
      )}
      <span className="truncate flex-1">{label}</span>
    </button>
    {onDelete && <button
      type="button"
      aria-label={`Delete ${remote ? 'remote' : 'local'} branch ${label}`}
      title={active ? 'Switch to another branch before deleting' : `Delete ${remote ? 'remote' : 'local'} branch ${label}`}
      disabled={active || disabled}
      onClick={onDelete}
      className="shrink-0 p-2 mr-1 rounded text-text-muted hover:text-danger hover:bg-danger/10 disabled:opacity-30 disabled:cursor-not-allowed"
    ><Trash2 size={13} /></button>}
    </div>
  );
}
