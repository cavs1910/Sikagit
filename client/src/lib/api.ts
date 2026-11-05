import type { ApiResponse, DiffPayload, DiffWhitespaceMode, GraphCommit } from '@sikagit/shared';
import { authGeneration, useAuthStore } from '../store/authStore';

const BASE_URL = '/api/v1';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const generation = authGeneration();
  const res = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (res.status === 401) {
    if (generation === authGeneration()) useAuthStore.getState().requireLogin();
    throw Object.assign(new Error('Sign in to continue'), { status: 401 });
  }

  const json: ApiResponse<T> = await res.json();

  if (!json.success) {
    throw Object.assign(new Error(json.error || 'Request failed'), { status: res.status, aiError: json.aiError });
  }

  return json.data as T;
}

export interface DirectoryEntry { name:string; path:string; type:'directory'|'file'|'blocked'; }
export interface TextFile { content:string; revision:string; lineEnding:'lf'|'crlf'; }
export const api = {
  aiModels: (provider:string, refresh=false) => request<import('@sikagit/shared').AIModelCatalog>('/ai/models?'+new URLSearchParams({provider,refresh:String(refresh)})),
  editorTree: (repo:string,directory='',showIgnored=false) => request<DirectoryEntry[]>('/editor/tree?'+new URLSearchParams({repo,directory,showIgnored:String(showIgnored)})),
  editorRead: (repo:string,file:string) => request<TextFile>('/editor/file?'+new URLSearchParams({repo,file})),
  editorRevision: (repo:string,file:string) => request<{revision:string}>('/editor/file?'+new URLSearchParams({repo,file,metadata:'true'})),
  editorSave: (repo:string,file:string,content:string,revision:string) => request<TextFile>('/editor/file',{method:'PUT',body:JSON.stringify({repo,file,content,revision})}),
  // Repos
  getRepos: () => request<import('@sikagit/shared').RepoBookmark[]>('/repos'),
  addRepo: (path: string) => request<import('@sikagit/shared').RepoBookmark>('/repos', {
    method: 'POST',
    body: JSON.stringify({ path }),
  }),
  deleteRepo: (id: string) => request<void>(`/repos/${id}`, { method: 'DELETE' }),
  updateRepo: (id: string, data: { name?: string; group?: string; avatar?: string; path?: string }) =>
    request<import('@sikagit/shared').RepoBookmark>(`/repos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  openRepo: (id: string) => request<import('@sikagit/shared').RepoBookmark>(`/repos/${id}/open`, { method: 'PATCH' }),

  // Projects
  getProjects: () => request<import('@sikagit/shared').Project[]>('/projects'),
  createProject: (name: string, repoIds: string[], avatar?: string) =>
    request<import('@sikagit/shared').Project>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, avatar, repoIds }),
    }),
  updateProject: (id: string, data: { name?: string; avatar?: string; repoIds?: string[] }) =>
    request<import('@sikagit/shared').Project>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  reorderProjects: (ids: string[]) =>
    request<import('@sikagit/shared').Project[]>('/projects/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  // Git
  getStatus: (repo: string) => request<import('@sikagit/shared').GitStatus>(`/git/status?repo=${encodeURIComponent(repo)}`),
  // Cached: instant DB read, no git ops. Use on boot + as a baseline.
  getStatusSummaryCached: (ids: string[]) =>
    request<Record<string, { ahead: number; behind: number; hasChanges: boolean; hasStaged: boolean; hasUnstaged: boolean; hasRemote: boolean; computedAt: string; lastCommitAt: string | null }>>(
      `/git/status-summary/cached?ids=${encodeURIComponent(ids.join(','))}`
    ),
  // Refresh: compute fresh summaries for a subset and write-through to the cache.
  refreshStatusSummary: (repos: { id: string; path: string }[]) =>
    request<Record<string, {
      ahead?: number;
      behind?: number;
      hasChanges?: boolean;
      hasStaged?: boolean;
      hasUnstaged?: boolean;
      hasRemote?: boolean;
      computedAt?: string;
      lastCommitAt?: string | null;
      skipped?: boolean;
      reason?: string;
      slowMode?: boolean;
      lastTimedOutAt?: string;
    }>>(
      '/git/status-summary/refresh',
      { method: 'POST', body: JSON.stringify({ repos }) }
    ),
  refreshStatusSummaryOne: (id: string, path: string) =>
    request<{
      ahead?: number; behind?: number; hasChanges?: boolean; hasStaged?: boolean; hasUnstaged?: boolean; hasRemote?: boolean;
      computedAt?: string;
      lastCommitAt?: string | null;
      skipped?: boolean;
      reason?: string;
      slowMode?: boolean;
      lastTimedOutAt?: string;
    }>('/git/status-summary/refresh-one', {
      method: 'POST',
      body: JSON.stringify({ id, path }),
    }),
  getLog: (repo: string, limit = 200, skip = 0, showReflog = false) =>
    request<import('@sikagit/shared').GitCommit[]>(`/git/log?repo=${encodeURIComponent(repo)}&limit=${limit}&skip=${skip}&showReflog=${showReflog}`),
  getGraph: (repo: string, limit = 200, skip = 0, showReflog = false) =>
    request<{ commits: GraphCommit[]; totalLanes: number }>(
      `/git/graph?repo=${encodeURIComponent(repo)}&limit=${limit}&skip=${skip}&showReflog=${showReflog}`
    ),
  getBranches: (repo: string) => request<import('@sikagit/shared').GitBranch[]>(`/git/branches?repo=${encodeURIComponent(repo)}`),
  mergeBranch: (repo: string, sourceBranch: string) =>
    request<{ message: string; merged: boolean; conflicts?: string[] }>('/git/merge', {
      method: 'POST',
      body: JSON.stringify({ repo, sourceBranch }),
    }),
  mergeToBranch: (repo: string, sourceBranch: string, targetBranch: string) =>
    request<{ message: string; merged: boolean; conflicts?: string[] }>('/git/merge-to', {
      method: 'POST',
      body: JSON.stringify({ repo, sourceBranch, targetBranch }),
    }),
  mergeAbort: (repo: string) =>
    request<void>('/git/merge/abort', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    }),
  deleteBranch: (repo: string, branch: string, force?: boolean) =>
    request<void>('/git/branch/delete', {
      method: 'POST',
      body: JSON.stringify({ repo, branch, force }),
    }),
  getTags: (repo: string) => request<import('@sikagit/shared').GitTag[]>(`/git/tags?repo=${encodeURIComponent(repo)}`),
  getCommitFiles: (repo: string, commit: string) =>
    request<{ path: string; status: string }[]>(`/git/commit-files?repo=${encodeURIComponent(repo)}&commit=${encodeURIComponent(commit)}`),
  // `ws` is the whitespace filter ('none' | 'eol' | 'all'). 'eol' hides pure
  // CRLF<->LF churn, which otherwise renders as a whole-file rewrite.
  getDiff: (repo: string, commit?: string, file?: string, ws: DiffWhitespaceMode = 'none') => {
    const params = new URLSearchParams({ repo });
    if (commit) params.set('commit', commit);
    if (file) params.set('file', file);
    if (ws !== 'none') params.set('ws', ws);
    return request<DiffPayload>(`/git/diff?${params}`);
  },
  getStagedDiff: (repo: string, file?: string, ws: DiffWhitespaceMode = 'none') => {
    const params = new URLSearchParams({ repo });
    if (file) params.set('file', file);
    if (ws !== 'none') params.set('ws', ws);
    return request<DiffPayload>(`/git/diff/staged?${params}`);
  },

  // Hunk operations
  stageHunk: (repo: string, patch: string) => request<void>('/git/stage-hunk', {
    method: 'POST',
    body: JSON.stringify({ repo, patch }),
  }),
  discardHunk: (repo: string, patch: string) => request<void>('/git/discard-hunk', {
    method: 'POST',
    body: JSON.stringify({ repo, patch }),
  }),

  // Operations
  removeLock: (repo: string) => request<{ removed: boolean }>(`/git/lock?repo=${encodeURIComponent(repo)}`, {
    method: 'DELETE',
  }),
  stageFiles: (repo: string, files: string[]) => request<void>('/git/stage', {
    method: 'POST',
    body: JSON.stringify({ repo, files }),
  }),
  unstageFiles: (repo: string, files: string[]) => request<void>('/git/unstage', {
    method: 'POST',
    body: JSON.stringify({ repo, files }),
  }),
  commit: (repo: string, message: string, amend = false) => request<{ hash: string }>('/git/commit', {
    method: 'POST',
    body: JSON.stringify({ repo, message, amend }),
  }),
  uncommit: (repo: string, hash: string) => request<void>('/git/uncommit', {
    method: 'POST',
    body: JSON.stringify({ repo, hash }),
  }),
  checkout: (repo: string, hash: string) => request<{ branch: string }>('/git/checkout', {
    method: 'POST',
    body: JSON.stringify({ repo, hash }),
  }),
  switchBranch: (repo: string, branch: string) => request<{ branch: string }>('/git/switch-branch', {
    method: 'POST',
    body: JSON.stringify({ repo, branch }),
  }),
  discardChanges: (repo: string, files: string[]) => request<void>('/git/discard', {
    method: 'POST',
    body: JSON.stringify({ repo, files }),
  }),
  deleteUntrackedFiles: (repo: string, files: string[]) => request<void>('/git/delete-untracked', {
    method: 'POST',
    body: JSON.stringify({ repo, files }),
  }),
  saveForLater: (repo: string, files: string[], branchName: string, message: string) =>
    request<{ branch: string; commitHash: string }>('/git/save-for-later', {
      method: 'POST',
      body: JSON.stringify({ repo, files, branchName, message }),
    }),

  // Git config
  getGitConfig: (repo: string) => request<import('@sikagit/shared').RepoConfig>(`/git/config?repo=${encodeURIComponent(repo)}`),
  setGitConfig: (repo: string, key: string, value: string) => request<void>('/git/config', {
    method: 'POST',
    body: JSON.stringify({ repo, key, value }),
  }),
  setRemoteUrl: (repo: string, url: string) => request<void>('/git/remote-url', {
    method: 'POST',
    body: JSON.stringify({ repo, url }),
  }),
  testRemote: (repo: string, url?: string) => request<{ ok: boolean; error?: string }>('/git/test-remote', {
    method: 'POST',
    body: JSON.stringify({ repo, url }),
  }),
  gitFetch: (repo: string) => request<void>('/git/fetch', {
    method: 'POST',
    body: JSON.stringify({ repo }),
  }),
  gitPull: (repo: string, strategy?: 'merge' | 'rebase', allowUnrelatedHistories?: boolean) => request<{ message: string }>('/git/pull', {
    method: 'POST',
    body: JSON.stringify({ repo, strategy, allowUnrelatedHistories }),
  }),
  gitPush: (repo: string, setUpstream?: boolean, upToCommit?: string, force?: boolean) => request<{ message: string }>('/git/push', {
    method: 'POST',
    body: JSON.stringify({ repo, setUpstream, upToCommit, force }),
  }),

  aiSettings: () => request<AISettings>('/ai/settings'),
  aiSaveSettings: (settings: AISettings & {apiKey?:string;removeKey?:boolean;byokApiKey?:string;removeByokKey?:boolean}) => request<AISettings>('/ai/settings',{method:'PUT',body:JSON.stringify(settings)}),
  aiTest: () => request<{ok:boolean}>('/ai/test',{method:'POST',body:'{}'}),
  // AI
  aiSuggest: (repo: string) =>
    request<{ title: string; description: string }>('/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    }),
  aiSuggestSaveForLater: (repo: string, files: string[]) =>
    request<{ branchName: string; message: string }>('/ai/suggest-save-for-later', {
      method: 'POST',
      body: JSON.stringify({ repo, files }),
    }),
  aiSmartCommitPreview: (repo: string) =>
    request<{ planId: string; groups: { files: string[]; title: string; description: string }[] }>('/ai/smart-commit/preview', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    }),
  aiSmartCommitExecute: (repo: string, groups: { files: string[]; title: string; description: string }[], planId: string) =>
    request<{ commits: { hash: string; message: string }[] }>('/ai/smart-commit/execute', {
      method: 'POST',
      body: JSON.stringify({ repo, groups, planId }),
    }),

  // Browse — resolve a folder name + file fingerprint to an absolute server path
  resolveFolder: (folderName: string, files: string[]) =>
    request<{ path: string; allMatches: string[] }>('/browse/resolve', {
      method: 'POST',
      body: JSON.stringify({ folderName, files }),
    }),
};

export interface AIConnection { model:string; hasApiKey:boolean; gatewayMode:'managed'|'byok'; byokProvider:string; hasByokKey:boolean; }
export interface AISettings extends AIConnection { connections:Record<string,AIConnection>; revision:string; enabled:boolean; provider:string; language:'en'|'auto'; conventionalCommits:boolean; maxDiffChars:number; maxOutputTokens:number; responseMode:'structured'|'json'; }
