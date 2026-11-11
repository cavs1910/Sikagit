/** Argument arrays used by execution and the optional, read-only UI preview. */
export interface GitCommand {
  args: string[];
  condition?: string;
}

export const mergeCommand = (source: string, fastForward?: boolean): string[] =>
  ['merge', ...(fastForward === undefined ? [] : [fastForward ? '--ff' : '--no-ff']), source];

export const switchForMergeCommand = (target: string): string[] => ['switch', '--no-guess', target];
export const deleteLocalBranchCommand = (branch: string, force = false): string[] => ['branch', force ? '-D' : '-d', '--', branch];
export const abortMergeCommand = (): string[] => ['merge', '--abort'];

export function deleteRemoteBranchCommands(target: string, tracking: string, tip: string, url: string): GitCommand[] {
  return [
    { args: ['push', '--porcelain', '--progress', '--no-follow-tags', '--recurse-submodules=no', '--no-signed', `--force-with-lease=${target}:${tip}`, url, `:${target}`, '--verbose'] },
    { args: ['update-ref', '-d', tracking, tip], condition: 'After remote deletion, only if the local tracking reference is unchanged.' },
  ];
}

/** Display only: execution always passes arguments directly to Git, never a shell. */
export function formatGitCommand(args: string[]): string {
  return ['git', ...args].map(arg => /^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`).join(' ');
}
