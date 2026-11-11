import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { X, GitMerge, GitBranch, ArrowDownUp, GripVertical, Loader2, AlertTriangle } from 'lucide-react';
import { Switch } from '../ui/Switch';
import { GitCommandPreview } from '../ui/GitCommandPreview';
import { mergeCommand, switchForMergeCommand, deleteLocalBranchCommand, abortMergeCommand } from '../../../../shared/types/gitCommands';
import type { GitCommand } from '../../../../shared/types/gitCommands';
import { useStatusStore } from '../../store/statusStore';
import { useLogStore } from '../../store/logStore';
import { useToastStore } from '../../store/toastStore';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

type Slot = 'source' | 'target';
interface MergeDialogProps {
  repoPath: string;
  preselectedBranch?: string;
  onClose: () => void;
}

export function MergeDialog({ repoPath, preselectedBranch, onClose }: MergeDialogProps) {
  const { status, branches, loadedRepo, fetchAll } = useStatusStore();
  const fetchLog = useLogStore(s => s.fetchLog);
  const addToast = useToastStore(s => s.addToast);
  const [currentBranch] = useState(() => loadedRepo === repoPath ? status?.current || 'HEAD' : 'HEAD');
  const localBranches = loadedRepo === repoPath ? branches.filter(branch => !branch.isRemote) : [];
  const [pair, setPair] = useState(() => {
    const current = localBranches.find(branch => branch.name === currentBranch)?.name;
    const other = localBranches.find(branch => branch.name !== currentBranch)?.name || '';
    if (preselectedBranch && preselectedBranch !== current && localBranches.some(branch => branch.name === preselectedBranch)) {
      return { sourceBranch: preselectedBranch, targetBranch: current || other };
    }
    const primary = localBranches.find(branch => branch.name === 'main')?.name || localBranches.find(branch => branch.name === 'master')?.name;
    const sourceBranch = current && current !== primary ? current : other;
    return { sourceBranch, targetBranch: primary && primary !== sourceBranch ? primary : current && current !== sourceBranch ? current : localBranches.find(branch => branch.name !== sourceBranch)?.name || '' };
  });
  const { sourceBranch, targetBranch } = pair;
  const source = localBranches.find(branch => branch.name === sourceBranch);
  const target = localBranches.find(branch => branch.name === targetBranch);
  const [deleteBranchAfter, setDeleteBranchAfter] = useState(false);
  const [fastForward, setFastForward] = useState(true);
  const [merging, setMerging] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const sourceCard = useRef<HTMLDivElement>(null);
  const targetCard = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ slot: Slot; id: number; startY: number } | null>(null);
  const [drag, setDrag] = useState<{ slot: Slot; delta: number; over: boolean } | null>(null);
  const busy = merging || aborting;
  const locked = busy || conflicts !== null;
  const validPair = !!source && !!target && sourceBranch !== targetBranch;
  const activeChanged = loadedRepo !== repoPath || status?.current !== currentBranch;
  const detached = !localBranches.some(branch => branch.name === currentBranch);
  const closeDialog = () => { if (!busy) onClose(); };

  const swap = () => {
    if (locked || !validPair) return;
    setPair({ sourceBranch: targetBranch, targetBranch: sourceBranch });
    setDeleteBranchAfter(false);
    setError('');
  };
  const selectBranch = (slot: Slot, value: string) => {
    if (locked) return;
    const next = slot === 'source'
      ? { sourceBranch: value, targetBranch: value === targetBranch ? sourceBranch : targetBranch }
      : { sourceBranch: value === sourceBranch ? targetBranch : sourceBranch, targetBranch: value };
    if (next.sourceBranch !== sourceBranch) setDeleteBranchAfter(false);
    setPair(next); setError('');
  };
  const isOverOther = (slot: Slot, x: number, y: number) => {
    const box = (slot === 'source' ? targetCard : sourceCard).current?.getBoundingClientRect();
    return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  };
  const beginDrag = (slot: Slot, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (locked || !validPair || pointer.current || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus();
    pointer.current = { slot, id: event.pointerId, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ slot, delta: 0, over: false });
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    setDrag({ slot: active.slot, delta: event.clientY - active.startY, over: isOverOther(active.slot, event.clientX, event.clientY) });
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    const reverse = !cancelled && isOverOther(active.slot, event.clientX, event.clientY);
    pointer.current = null; setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (reverse) swap();
  };

  const handleMerge = async () => {
    if (locked || !source || !target || !validPair || detached || activeChanged) return;
    setMerging(true); setError('');
    try {
      const result = await api.mergeBranches(repoPath, {
        sourceBranch, targetBranch, expectedBranch: currentBranch,
        expectedSourceCommit: source.commit, expectedTargetCommit: target.commit, fastForward,
      });
      if (result.merged) {
        addToast('success', result.message);
        if (deleteBranchAfter) {
          try {
            await api.deleteBranch(repoPath, sourceBranch, false, source.commit);
            addToast('info', `Deleted branch ${sourceBranch}`);
          } catch (failure) {
            addToast('error', `Merge succeeded but failed to delete branch: ${failure instanceof Error ? failure.message : 'Unknown error'}`);
          }
        }
        onClose();
      } else {
        setConflicts(result.conflicts || []); setError(result.message);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Merge failed');
    } finally {
      void fetchLog(repoPath); void fetchAll(repoPath); setMerging(false);
    }
  };
  const handleAbort = async () => {
    setAborting(true);
    try {
      await api.mergeAbort(repoPath); addToast('info', 'Merge aborted'); onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Failed to abort merge');
    } finally {
      void fetchAll(repoPath); void fetchLog(repoPath); setAborting(false);
    }
  };
  const commands: GitCommand[] = conflicts ? [{ args: abortMergeCommand() }] : validPair ? [
    ...(targetBranch !== currentBranch ? [{ args: switchForMergeCommand(targetBranch) }] : []),
    { args: mergeCommand(`refs/heads/${sourceBranch}`, fastForward) },
    ...(deleteBranchAfter ? [{ args: deleteLocalBranchCommand(sourceBranch), condition: 'Only after a successful merge.' }] : []),
  ] : [];

  const card = (slot: Slot) => {
    const branch = slot === 'source' ? source : target;
    const dragging = drag?.slot === slot;
    const highlighted = drag && drag.slot !== slot && drag.over;
    return <div ref={slot === 'source' ? sourceCard : targetCard} role="group" aria-label={slot === 'source' ? 'Source branch card' : 'Destination branch card'}
      className={cn('merge-branch-card relative flex items-center gap-2 rounded-lg border p-3 transition-colors', slot === 'source' ? 'border-success/25 bg-success/5' : 'border-accent/25 bg-accent/5', dragging && 'z-10 shadow-xl opacity-90', highlighted && 'ring-2 ring-accent bg-accent/10')}
      style={dragging ? { transform: `translateY(${drag.delta}px)` } : undefined}>
      <button type="button" aria-label={`Drag ${slot === 'source' ? 'source' : 'destination'} branch to swap`} title="Drag onto the other branch to reverse direction"
        disabled={locked || !validPair} style={{ touchAction: 'none' }}
        onPointerDown={event => beginDrag(slot, event)} onPointerMove={moveDrag}
        onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)}
        onLostPointerCapture={() => { pointer.current = null; setDrag(null); }}
        onKeyDown={event => {
          if (['Enter', ' ', slot === 'source' ? 'ArrowDown' : 'ArrowUp'].includes(event.key)) { event.preventDefault(); swap(); }
        }}
        className="shrink-0 p-1.5 rounded cursor-grab active:cursor-grabbing text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 disabled:cursor-default">
        <GripVertical size={17} />
      </button>
      <label className="flex-1 min-w-0 space-y-1.5">
        <span className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold', slot === 'source' ? 'text-success' : 'text-accent')}><GitBranch size={12} />{slot === 'source' ? 'From' : 'Into'}</span>
        <select aria-label={slot === 'source' ? 'Source branch' : 'Destination branch'} value={branch?.name || ''} disabled={locked}
          onChange={event => selectBranch(slot, event.target.value)} className="w-full min-w-0 rounded border border-border bg-bg-primary px-2 py-1.5 text-xs text-text-primary">
          {!branch && <option value="">Select a branch…</option>}
          {localBranches.map(item => <option key={item.name} value={item.name}>{item.name}{item.name === status?.current ? ' (current)' : ''}</option>)}
        </select>
        <span className="block text-[10px] text-text-muted font-mono">{branch?.commit.slice(0, 7) || 'No branch selected'}</span>
      </label>
    </div>;
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={closeDialog}>
    <div role="dialog" aria-modal="true" aria-label="Merge branches" className="app-dialog bg-bg-secondary border border-border rounded-lg w-[460px] shadow-xl flex flex-col"
      style={{ maxHeight: 'calc(var(--app-viewport-height, 100dvh) - 2rem)' }} onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h2 className="flex items-center gap-2 text-sm font-medium"><GitMerge size={16} className="text-accent" />Merge branches</h2>
        <button disabled={busy} aria-label="Close merge dialog" onClick={closeDialog} className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-tertiary"><X size={14} /></button>
      </div>
      <div className="p-4 space-y-4 min-h-0 overflow-y-auto">
        <div>
          {card('source')}
          <div className="flex flex-col items-center py-1">
            <span aria-hidden="true" className="h-1.5 w-px bg-border" />
            <button type="button" aria-label="Swap branches" title="Reverse merge direction" disabled={locked || !validPair} onClick={swap}
              className="flex items-center justify-center h-8 w-8 rounded-full border border-border bg-bg-primary text-text-secondary hover:text-accent hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30"><ArrowDownUp size={16} /></button>
            <span aria-hidden="true" className="h-1.5 w-px bg-border" />
          </div>
          {card('target')}
          <p role="status" className="mt-2 text-center text-xs text-text-secondary break-all">{validPair ? <><span className="text-success">{sourceBranch}</span> → <span className="text-accent">{targetBranch}</span></> : 'Choose two different local branches.'}</p>
          <p className="mt-1 text-center text-[10px] text-text-muted">Drag a handle to reverse, or use the arrows.</p>
        </div>
        <p className="text-[0.7rem] text-text-secondary">{conflicts ? `Merge paused on ${targetBranch}. Resolve conflicts or abort.` : detached ? 'Check out a local branch before merging.' : targetBranch === currentBranch ? `Merges into the current branch, ${targetBranch}.` : `Switches to ${targetBranch || 'the destination'} before merging.`} Stay on the destination after merging or aborting. Commit or stash local changes first. No push.</p>
        <div className="space-y-3 border-t border-border pt-3">
          <Switch label="Allow fast-forward" checked={fastForward} onChange={setFastForward} disabled={locked} className="w-full"
            description={fastForward ? 'Fast-forward when possible. Otherwise create a merge commit.' : 'Create a merge commit even when fast-forward is possible.'} />
          <Switch label="Delete source branch after merge" checked={deleteBranchAfter} onChange={setDeleteBranchAfter} disabled={locked || !validPair} className="w-full"
            description={sourceBranch ? `Delete local ${sourceBranch} only after success. Remote branches are kept.` : 'Delete only after a successful merge.'} />
        </div>
        <GitCommandPreview commands={commands} />
        {(error || (activeChanged && !busy && !conflicts)) && <div role="alert" className="flex items-start gap-2 p-3 rounded bg-danger/10 text-xs text-danger"><AlertTriangle size={14} className="shrink-0" /><span>{error || 'The active branch changed. Reopen Merge to review it.'}</span></div>}
        {conflicts && conflicts.length > 0 && <div className="space-y-2 text-xs">
          <p className="text-text-secondary">Resolve these conflicts and commit, or abort the merge:</p>
          <div className="max-h-32 overflow-y-auto font-mono text-danger">{conflicts.map(file => <p key={file} className="break-all">{file}</p>)}</div>
        </div>}
      </div>
      <div className="flex justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
        {conflicts ? <button onClick={() => void handleAbort()} disabled={aborting} className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-danger text-white disabled:opacity-40">{aborting && <Loader2 size={12} className="animate-spin" />}Abort Merge</button> : <>
          <button disabled={busy} onClick={closeDialog} className="px-3 py-1.5 rounded text-xs text-text-secondary hover:bg-bg-tertiary disabled:opacity-40">Cancel</button>
          <button onClick={() => void handleMerge()} disabled={!validPair || busy || detached || activeChanged} className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-accent-emphasis text-white disabled:opacity-40">
            {merging ? <><Loader2 size={12} className="animate-spin" />Merging...</> : <><GitMerge size={12} />Merge</>}
          </button>
        </>}
      </div>
    </div>
  </div>;
}
