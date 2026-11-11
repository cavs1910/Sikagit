import { useEffect, useState } from 'react';
import { formatGitCommand } from '../../../../shared/types/gitCommands';
import type { GitCommand } from '../../../../shared/types/gitCommands';

/** Shared disclosure for reviewing operations before confirming them. */
export function GitCommandPreview({ commands = [], loadCommands }: {
  commands?: GitCommand[];
  loadCommands?: () => Promise<GitCommand[]>;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<GitCommand[]>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || !loadCommands) return;
    let cancelled = false;
    setLoading(true); setLoaded(undefined); setError('');
    loadCommands().then(value => { if (!cancelled) setLoaded(value); })
      .catch(() => { if (!cancelled) setError('Could not load the commands. Refresh the branch list or preview and try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, loadCommands, retry]);

  return (
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="git-command-preview min-w-0 rounded border border-border bg-bg-primary/50 text-xs">
      <summary className="cursor-pointer px-3 py-2 text-text-secondary focus-visible:outline-2 focus-visible:outline-accent">Show Git commands</summary>
      {open && <div className="space-y-2 px-3 pb-3 min-w-0">
        <p className="text-[0.65rem] text-text-muted">Main operations in the selected repository. The server also applies validation and internal safety options.</p>
        {loading ? <p role="status" className="text-text-muted">Loading commands…</p>
          : error ? <div role="alert" className="space-y-2 text-danger"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)} className="underline">Retry command preview</button></div>
          : <div className="max-h-56 overflow-y-auto space-y-2" aria-label="Git commands">
            {(loadCommands ? loaded || [] : commands).map((command, index) => <div key={index}>
              {command.condition && <p className="mb-1 text-[0.65rem] text-text-muted">{command.condition}</p>}
              <pre className="whitespace-pre-wrap break-all rounded bg-bg-primary border border-border p-2 font-mono text-[0.7rem] text-text-primary"><code>{formatGitCommand(command.args)}</code></pre>
            </div>)}
          </div>}
      </div>}
    </details>
  );
}
