import { useRepoStore } from '../../store/repoStore';
import { GitBranch, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { useStatusStore } from '../../store/statusStore';
import { useActivityStore } from '../../store/activityStore';

export function StatusBar() {
  const repo = useRepoStore(s => s.repos.find(r => r.id === s.activeRepoId)?.path);
  const status = useStatusStore(s => s.loadedRepo === repo ? s.status : null);
  const pendingStaged = useStatusStore(s => s.pendingStaged);
  const pendingUnstaged = useStatusStore(s => s.pendingUnstaged);
  const loading = useStatusStore(s => s.loading);
  const activities = useActivityStore(s => s.entries);

  const pendingCount = pendingStaged.size + pendingUnstaged.size;
  // Newest activity is the most informative — show that one.
  const latestActivity = activities.length > 0 ? activities[activities.length - 1] : null;

  let activityLabel: string | null = null;
  if (latestActivity) {
    activityLabel = latestActivity.label;
  } else if (loading) {
    activityLabel = 'Refreshing…';
  } else if (pendingCount > 0) {
    activityLabel = `Syncing ${pendingCount} file change${pendingCount !== 1 ? 's' : ''}…`;
  }

  return (
    <div className="status-bar shrink-0 h-6 bg-bg-secondary border-t border-border flex items-center px-3 text-xs text-text-secondary gap-4">
      {status && (
        <>
          <div className="status-branch flex items-center gap-1" title={status.current || 'detached'}>
            <GitBranch size={12} className="shrink-0" />
            <span>{status.current || 'detached'}</span>
          </div>
          {status.tracking && (
            <div className="flex items-center gap-2">
              {status.ahead > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowUp size={10} />
                  {status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className="flex items-center gap-0.5">
                  <ArrowDown size={10} />
                  {status.behind}
                </span>
              )}
            </div>
          )}
          {status.files.length > 0 && (
            <span>{status.files.length} changed</span>
          )}
        </>
      )}
      <div className="flex-1" />
      {activityLabel && (
        <div
          className="status-activity flex items-center gap-1.5 text-accent"
          role="status"
          aria-label={activityLabel}
          title={activities.length > 1 ? activities.map(a => a.label).join('\n') : activityLabel}
        >
          <Loader2 size={11} className="animate-spin" />
          <span className="truncate max-w-[260px]">{activityLabel}</span>
          {activities.length > 1 && (
            <span className="text-text-muted">+{activities.length - 1}</span>
          )}
        </div>
      )}
      <span className="text-text-muted">SikaGit</span>
    </div>
  );
}
