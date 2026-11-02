import { Cloud, CloudUpload, CircleHelp } from 'lucide-react';
import type { GitCommit } from '@sikagit/shared';

export function CommitPublication({ state, showLabel = false }: { state: GitCommit['publication']; showLabel?: boolean }) {
  const info = state === 'published'
    ? { Icon: Cloud, label: 'Published', color: 'text-success', detail: 'Contained in a known remote branch.' }
    : state === 'local'
      ? { Icon: CloudUpload, label: 'Only local', color: 'text-text-muted', detail: 'Not found in known remote branches.' }
      : { Icon: CircleHelp, label: 'Publication unknown', color: 'text-text-muted', detail: 'Remote reachability could not be determined.' };
  const { Icon } = info;
  return <span
    role="img"
    aria-label={info.label}
    title={`${info.label}: ${info.detail} Based on local remote-tracking refs; Fetch refreshes them.`}
    className={`inline-flex shrink-0 items-center gap-1 ${info.color}`}
  >
    <Icon size={12} aria-hidden="true" />
    {showLabel && <span>{info.label}</span>}
  </span>;
}
