import { create } from 'zustand';
import type { GraphCommit } from '@sikagit/shared';
import { api } from '../lib/api';
import { useUIStore } from './uiStore';
import { rememberRepo } from '../lib/repoCache';

export interface CommitFile {
  path: string;
  status: string;
}

interface LogState {
  activateRepo: (repo: string | null) => void;
  commits: GraphCommit[];
  totalLanes: number;
  loading: boolean;
  error: string | null;
  selectedCommit: string | null;
  commitFiles: CommitFile[];
  commitFilesLoading: boolean;
  selectedCommitFile: string | null;
  hasMore: boolean;
  // Path of the repo the current `commits` belong to (null before the first load).
  loadedRepo: string | null;
  loadedShowReflog: boolean;
  // `reset` forces a clear-and-reload; repo/mode changes also clear the list.
  // A same-repo, same-mode call refreshes in place.
  fetchLog: (repo: string, reset?: boolean) => Promise<void>;
  loadMore: (repo: string) => Promise<void>;
  selectCommit: (hash: string | null) => void;
  fetchCommitFiles: (repo: string, commit: string) => Promise<void>;
  selectCommitFile: (path: string | null) => void;
}

const PAGE_SIZE = 200;
// An in-place refresh re-reads everything already on screen so a scrolled list
// doesn't shrink under the user; this caps that window so a deep scroll can't
// turn every tab-focus into a huge `git log`.
const MAX_REFRESH_WINDOW = 500; // Match the server's bounded page size.
const MAX_CACHED_COMMITS = 1000;

type Snapshot = Pick<LogState, 'commits' | 'totalLanes' | 'hasMore'>;
const emptySnapshot = (): Snapshot => ({ commits: [], totalLanes: 0, hasMore: true });
const cache = new Map<string, Snapshot>();
const requests = new Map<string, number>();
const keyFor = (repo: string, mode: boolean) => JSON.stringify([repo, mode]);
let sequence = 0, filesSequence = 0;
function remember(repo: string, mode: boolean, snapshot: Snapshot) {
  rememberRepo(cache, keyFor(repo, mode), {
    totalLanes: snapshot.totalLanes, commits: snapshot.commits.slice(0, MAX_CACHED_COMMITS),
    hasMore: snapshot.hasMore || snapshot.commits.length > MAX_CACHED_COMMITS,
  });
}

export const useLogStore = create<LogState>()((set, get) => ({
  ...emptySnapshot(),
  loading: false, error: null, loadedRepo: null, loadedShowReflog: false,
  selectedCommit: null, commitFiles: [], commitFilesLoading: false, selectedCommitFile: null,

  activateRepo: (repo) => {
    ++filesSequence;
    const mode = useUIStore.getState().showReflog;
    set({ ...(repo ? cache.get(keyFor(repo, mode)) : null) || emptySnapshot(),
      loadedRepo: repo, loadedShowReflog: mode, loading: !!repo, error: null,
      selectedCommit: null, commitFiles: [], commitFilesLoading: false, selectedCommitFile: null });
  },

  fetchLog: async (repo, reset = false) => {
    const mode = useUIStore.getState().showReflog, key = keyFor(repo, mode), seq = ++sequence;
    requests.set(key, seq);
    const current = get().loadedRepo === repo && get().loadedShowReflog === mode;
    const snapshot = current ? get() : cache.get(key);
    const limit = reset ? PAGE_SIZE : Math.min(Math.max(PAGE_SIZE, snapshot?.commits.length || 0), MAX_REFRESH_WINDOW);
    if (reset) cache.delete(key);
    if (current) set({ ...(reset ? emptySnapshot() : {}), loading: true, error: null });
    try {
      const graph = await api.getGraph(repo, limit, 0, mode);
      if (requests.get(key) !== seq || mode !== useUIStore.getState().showReflog) return;
      const result = { ...graph, hasMore: graph.commits.length === limit };
      remember(repo, mode, result);
      if (get().loadedRepo === repo && get().loadedShowReflog === mode) set({ ...result, loading: false });
    } catch (err) {
      if (requests.get(key) === seq && get().loadedRepo === repo && get().loadedShowReflog === mode) set({ error: (err as Error).message, loading: false });
    }
  },

  loadMore: async (repo) => {
    const { commits, totalLanes, loading, hasMore, loadedRepo, loadedShowReflog: mode } = get();
    if (loading || !hasMore || loadedRepo !== repo || mode !== useUIStore.getState().showReflog) return;
    const key = keyFor(repo, mode), seq = ++sequence;
    requests.set(key, seq); set({ loading: true });
    try {
      const graph = await api.getGraph(repo, PAGE_SIZE, commits.length, mode);
      if (requests.get(key) !== seq || mode !== useUIStore.getState().showReflog) return;
      const result = { commits: [...commits, ...graph.commits], totalLanes: Math.max(totalLanes, graph.totalLanes), hasMore: graph.commits.length === PAGE_SIZE };
      remember(repo, mode, result);
      if (get().loadedRepo === repo && get().loadedShowReflog === mode) set({ ...result, loading: false });
    } catch (err) {
      if (requests.get(key) === seq && get().loadedRepo === repo && get().loadedShowReflog === mode) set({ error: (err as Error).message, loading: false });
    }
  },

  selectCommit: (hash) => {
    ++filesSequence;
    set({ selectedCommit: hash, commitFiles: [], commitFilesLoading: false, selectedCommitFile: null });
  },
  fetchCommitFiles: async (repo, commit) => {
    if (get().loadedRepo !== repo || get().selectedCommit !== commit) return;
    const seq = ++filesSequence;
    set({ commitFilesLoading: true });
    try {
      const files = await api.getCommitFiles(repo, commit);
      if (seq === filesSequence && get().loadedRepo === repo && get().selectedCommit === commit) set({ commitFiles: files, commitFilesLoading: false });
    } catch {
      if (seq === filesSequence) set({ commitFiles: [], commitFilesLoading: false });
    }
  },
  selectCommitFile: (path) => set({ selectedCommitFile: path }),
}));

useLogStore.subscribe(state => {
  if (state.loadedRepo) remember(state.loadedRepo, state.loadedShowReflog, state);
});
useUIStore.subscribe((state, previous) => {
  if (state.showReflog === previous.showReflog) return;
  cache.clear(); requests.clear();
  const repo = useLogStore.getState().loadedRepo;
  useLogStore.getState().activateRepo(repo);
  if (repo) void useLogStore.getState().fetchLog(repo, true);
});
