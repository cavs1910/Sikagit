import { Cloud, CloudUpload, CloudOff, ArrowDown, GitFork, CircleHelp } from 'lucide-react';
import type { GitStatus } from '@sikagit/shared';

export function BranchPublicationStatus({ status }: { status: GitStatus }) {
  const hasRemote = status.hasRemote ?? !!(status.tracking || status.remoteUrl);
  const info = status.detached
    ? { Icon: GitFork, label: 'Detached HEAD', color: 'text-warning', detail: 'No current branch to compare with an upstream.' }
    : !status.tracking
      ? { Icon: CloudOff, label: hasRemote ? 'No upstream' : 'No remote', color: 'text-text-muted', detail: hasRemote ? 'Branch has no upstream. Push sets one; commits may already exist in another remote branch.' : 'No remote is configured for publication.' }
      : status.upstreamStatus === 'missing'
        ? { Icon: CloudOff, label: 'Upstream missing', color: 'text-warning', detail: `The configured upstream ${status.tracking} is not available locally. Fetch to refresh remote refs.` }
        : status.upstreamStatus === 'local'
          ? { Icon: GitFork, label: 'Local upstream', color: 'text-text-muted', detail: `${status.tracking} is a local branch, not a remote publication target.` }
          : status.upstreamStatus !== 'remote'
            ? { Icon: CircleHelp, label: 'Status unknown', color: 'text-text-muted', detail: 'Upstream publication status has not been verified.' }
            : status.ahead > 0
              ? { Icon: CloudUpload, label: `${status.ahead} unpushed${status.behind > 0 ? ` · ${status.behind} to pull` : ''}`, color: 'text-accent', detail: `Compared with ${status.tracking}.` }
              : status.behind > 0
                ? { Icon: ArrowDown, label: `${status.behind} to pull`, color: 'text-warning', detail: `No local commits to push; ${status.tracking} has newer commits.` }
                : { Icon: Cloud, label: 'Up to date', color: 'text-success', detail: `Branch matches ${status.tracking}.` };
  const { Icon } = info;
  return <span
    aria-label={`Branch publication: ${info.label}`}
    title={`${info.detail} Based on local remote-tracking refs; Fetch refreshes them.`}
    className={`inline-flex items-center gap-1.5 text-[0.65rem] cursor-default ${info.color}`}
  >
    <Icon size={13} className="shrink-0" aria-hidden="true" />
    <span>{info.label}</span>
  </span>;
}
