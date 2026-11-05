import { useState } from 'react';
import { Settings } from 'lucide-react';
import type { RepoBookmark } from '@sikagit/shared';
import { BranchSwitcher } from './BranchSwitcher';
import { RepoSettingsDialog } from '../operations/RepoSettingsDialog';
import { MergeDialog } from '../operations/MergeDialog';

export function RepositoryHeader({ repo, mobile = false }: { repo: RepoBookmark; mobile?: boolean }) {
  const [settings, setSettings] = useState(false);
  const [merge, setMerge] = useState<'from' | 'to' | null>(null);
  return <>
    <span title={repo.name} className={`text-sm font-semibold text-text-primary demo-blur truncate ${mobile ? 'min-w-0 flex-1' : 'max-w-[240px]'}`}>{repo.name}</span>
    <BranchSwitcher repoPath={repo.path} compact={mobile} onMerge={setMerge} />
    <button type="button" onClick={() => setSettings(true)} className="shrink-0 p-2 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary" title="Repository settings" aria-label="Repository settings"><Settings size={mobile ? 16 : 12} /></button>
    {settings && <RepoSettingsDialog repo={repo} onClose={() => setSettings(false)} />}
    {merge && <MergeDialog repoPath={repo.path} mode={merge} onClose={() => setMerge(null)} />}
  </>;
}
