import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Trash2, X } from 'lucide-react';
import type { BranchCleanupPreview, BranchCleanupResult } from '@sikagit/shared';
import { api } from '../../lib/api';
import { useConfirmStore } from '../../store/confirmStore';
import { useStatusStore } from '../../store/statusStore';
import { useLogStore } from '../../store/logStore';

const label = (name: string) => name.replace(/^remotes\//, '');

export function BranchCleanupDialog({ repoPath, onClose }: { repoPath: string; onClose: () => void }) {
  const [preview, setPreview] = useState<BranchCleanupPreview>();
  const [baseRef, setBaseRef] = useState<string>();
  const [includeLocal, setIncludeLocal] = useState(true);
  const [includeRemote, setIncludeRemote] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BranchCleanupResult>();
  const [refresh, setRefresh] = useState(0);
  const confirm = useConfirmStore(s => s.confirm);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setResult(undefined); setSelected(new Set());
    api.previewBranchCleanup(repoPath, baseRef, includeLocal, includeRemote)
      .then(data => {
        if (cancelled) return;
        setPreview(data);
        setSelected(new Set(data.candidates.map(c => c.ref)));
      })
      .catch(e => { if (!cancelled) { setPreview(undefined); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repoPath, baseRef, includeLocal, includeRemote, refresh]);

  const execute = async () => {
    if (!preview || running || loading || !selected.size) return;
    setRunning(true);
    try {
      if (!(await confirm({
        title: 'Delete merged branches?',
        message: `Delete ${selected.size} selected branches already merged into ${label(preview.base.name)}?\n\nRemote entries will be deleted from the server. Main/master and checked-out branches are protected. Review the selected list before confirming.`,
        confirmLabel: 'Delete selected branches', variant: 'danger',
      }))) return;
      setError('');
      try {
        const outcome = await api.executeBranchCleanup(repoPath, preview.planId, [...selected]);
        setResult(outcome);
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Cleanup failed');
        // The plan may have expired or been consumed; require a fresh preview.
        setPreview(undefined);
      } finally {
        void useStatusStore.getState().fetchAll(repoPath);
        void useLogStore.getState().fetchLog(repoPath);
      }
    } finally { setRunning(false); }
  };
  const reloadPreview = () => { setLoading(true); setSelected(new Set()); setRefresh(n => n + 1); };
  const close = () => { if (!running) onClose(); };
  const controlsDisabled = running || loading;
  const baseIsRemote = (baseRef || preview?.base.ref || '').startsWith('refs/remotes/');
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="Clean up merged branches" className="app-dialog w-[560px] max-h-[85dvh] flex flex-col bg-bg-secondary border border-border rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-medium"><Trash2 size={16} />Clean up merged branches</h2>
          <button aria-label="Close branch cleanup" disabled={running} onClick={close} className="p-2 text-text-muted"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto min-h-0 text-xs">
          <p className="text-text-secondary">Only branches whose commits are ancestors of the chosen main/master are included. Squash merges and cherry-picks may remain because their commit history differs.</p>
          {preview && <label className="block space-y-1">
            <span>Already merged into</span>
            <select aria-label="Cleanup base branch" disabled={controlsDisabled || !!result} value={baseRef || preview.base.ref} onChange={e => { reloadPreview(); setBaseRef(e.target.value); if (!e.target.value.startsWith('refs/remotes/')) { setIncludeRemote(false); setIncludeLocal(true); } }} className="w-full p-2 rounded border border-border bg-bg-primary min-w-0">
              {preview.bases.map(b => <option key={b.ref} value={b.ref}>{label(b.name)} ({b.isRemote ? 'last Fetch' : 'local'})</option>)}
            </select>
          </label>}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeLocal} disabled={controlsDisabled || !!result || (!includeRemote && includeLocal)} onChange={e => { reloadPreview(); setIncludeLocal(e.target.checked); }} />Local branches</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeRemote} disabled={controlsDisabled || !!result || !baseIsRemote || (!includeLocal && includeRemote)} onChange={e => { reloadPreview(); setIncludeRemote(e.target.checked); }} />Remote branches on this remote</label>
          </div>
          <p className="text-text-muted">For remote cleanup, choose a remote main/master and Fetch first. Other remotes are kept. Main, master and branches in use are preserved. Cleanup never forces deletion.</p>
          {loading && <p role="status" className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Checking merged branches…</p>}
          {error && <p role="alert" className="text-danger break-words">{error}</p>}
          {!loading && preview && !result && <>
            <div className="flex items-center justify-between gap-2">
              <p>{preview.candidates.length} eligible branch(es){preview.totalCandidates > preview.limit && ` of ${preview.totalCandidates}; run again for the next batch`} · {selected.size} selected</p>
              <button disabled={running} onClick={() => setSelected(selected.size === preview.candidates.length ? new Set() : new Set(preview.candidates.map(c => c.ref)))} className="shrink-0 text-accent">{selected.size === preview.candidates.length ? 'Deselect all' : 'Select all'}</button>
            </div>
            {!preview.candidates.length && <p className="text-text-muted">No merged branches to delete in this scope.</p>}
            <div className="space-y-1">
              {preview.candidates.map(branch => <label key={branch.ref} className="flex items-start gap-2 p-2 rounded border border-border">
                <input type="checkbox" aria-label={`Delete ${branch.isRemote ? 'remote' : 'local'} ${label(branch.name)}`} disabled={running} checked={selected.has(branch.ref)} onChange={e => setSelected(previous => { const next = new Set(previous); if (e.target.checked) next.add(branch.ref); else next.delete(branch.ref); return next; })} />
                <span className="min-w-0 break-all"><span className="text-text-muted">{branch.isRemote ? 'Remote' : 'Local'} · </span>{label(branch.name)}</span>
              </label>)}
            </div>
          </>}
          {result && <div role="status" className="space-y-2">
            <p>{result.results.filter(r => r.status === 'deleted').length} deleted · {result.results.filter(r => r.status === 'failed').length} failed · {result.results.filter(r => r.status === 'skipped').length} skipped</p>
            {result.results.map(r => <div key={r.ref} className="p-2 border border-border rounded break-all"><span className={r.status === 'deleted' ? 'text-success' : 'text-danger'}>{r.status}</span> · {r.isRemote ? 'Remote' : 'Local'} {label(r.name)}{r.message && <p className="mt-1 text-text-secondary">{r.message}</p>}</div>)}
          </div>}
        </div>
        <div className="px-4 py-3 border-t border-border flex flex-wrap justify-end gap-2 shrink-0 text-xs">
          <button disabled={running} onClick={close} className="px-3 py-2 text-text-secondary">Close</button>
          <button disabled={controlsDisabled} onClick={() => { if (!preview) setBaseRef(undefined); reloadPreview(); }} className="px-3 py-2 border border-border rounded">Refresh preview</button>
          {!result && <button disabled={controlsDisabled || !preview || !selected.size} onClick={() => void execute()} className="px-3 py-2 bg-danger text-white rounded disabled:opacity-40 flex items-center gap-2">{running && <Loader2 size={13} className="animate-spin" />}{running ? 'Cleaning branches…' : `Delete selected (${selected.size})`}</button>}
        </div>
      </div>
    </div>, document.body,
  );
}
