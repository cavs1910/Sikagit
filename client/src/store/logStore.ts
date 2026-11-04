import { create } from 'zustand';
import type { GraphCommit } from '@sikagit/shared';
import { api } from '../lib/api';
import { useUIStore } from './uiStore';

export interface CommitFile {
  path: string;
  status: string;
}

interface LogState {
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
const MAX_REFRESH_WINDOW = 1000;

// Monotonic request id. A response is only applied if no newer log request
// (refresh or repo switch) was started after it — otherwise a slow reply for the
// previous repo would overwrite the list of the one now open.
let requestSeq = 0;

export const useLogStore = create<LogState>()((set, get) => ({
  commits: [],
  totalLanes: 0,
  loading: false,
  error: null,
  selectedCommit: null,
  commitFiles: [],
  commitFilesLoading: false,
  selectedCommitFile: null,
  hasMore: true,
  loadedRepo: null,
  loadedShowReflog: false,

  fetchLog: async (repo: string, reset?: boolean) => {
    const seq = ++requestSeq;
    const showReflog = useUIStore.getState().showReflog;
    const switching = reset || get().loadedRepo !== repo || get().loadedShowReflog !== showReflog;
    const limit = switching
      ? PAGE_SIZE
      : Math.min(Math.max(PAGE_SIZE, get().commits.length), MAX_REFRESH_WINDOW);
    // Switching repos/modes: drop the old list so the loading state shows. Otherwise:
    // keep what's on screen and swap in the fresh graph when it lands (no flash)
    // — this is what focus/visibility/re-open refreshes rely on.
    set(switching
      ? { commits: [], hasMore: true, totalLanes: 0, loadedRepo: repo, loadedShowReflog: showReflog, loading: true, error: null }
      : { loading: true, error: null });
    try {
      const graph = await api.getGraph(repo, limit, 0, showReflog);
      if (seq !== requestSeq) return; // superseded — a newer request owns the list
      set({
        commits: graph.commits,
        totalLanes: graph.totalLanes,
        loading: false,
        hasMore: graph.commits.length === limit,
        loadedRepo: repo,
      });
    } catch (err: any) {
      if (seq !== requestSeq) return;
      set({ error: err.message, loading: false });
    }
  },

  loadMore: async (repo: string) => {
    const { commits, loading, hasMore, loadedRepo, loadedShowReflog } = get();
    if (loading || !hasMore || loadedRepo !== repo || loadedShowReflog !== useUIStore.getState().showReflog) return;
    const seq = ++requestSeq;
    set({ loading: true });
    try {
      const graph = await api.getGraph(repo, PAGE_SIZE, commits.length, loadedShowReflog);
      if (seq !== requestSeq) return; // a refresh/switch replaced the list meanwhile
      set(state => ({
        commits: [...state.commits, ...graph.commits],
        totalLanes: Math.max(state.totalLanes, graph.totalLanes),
        loading: false,
        hasMore: graph.commits.length === PAGE_SIZE,
      }));
    } catch (err: any) {
      if (seq !== requestSeq) return;
      set({ error: err.message, loading: false });
    }
  },

  selectCommit: (hash: string | null) => set({
    selectedCommit: hash,
    commitFiles: [],
    selectedCommitFile: null,
  }),

  fetchCommitFiles: async (repo: string, commit: string) => {
    set({ commitFilesLoading: true });
    try {
      const files = await api.getCommitFiles(repo, commit);
      set({ commitFiles: files, commitFilesLoading: false });
    } catch {
      set({ commitFiles: [], commitFilesLoading: false });
    }
  },

  selectCommitFile: (path: string | null) => set({ selectedCommitFile: path }),
}));

// A mode change invalidates the cached list and any in-flight page before
// reloading from the start. Every refresh/pagination request uses the same mode.
useUIStore.subscribe((state, previous) => {
  if (state.showReflog === previous.showReflog) return;
  const { loadedRepo: repo, selectCommit } = useLogStore.getState();
  selectCommit(null);
  if (repo) void useLogStore.getState().fetchLog(repo, true);
});
