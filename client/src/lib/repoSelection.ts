import { useRepoStore } from '../store/repoStore';
import { useStatusStore } from '../store/statusStore';
import { useLogStore } from '../store/logStore';

// Subscribe before React mounts so every selection path (sidebar, URL,
// back/forward, removal or path edit) swaps data before the new repo renders.
const path = (state: ReturnType<typeof useRepoStore.getState>) =>
  state.repos.find(repo => repo.id === state.activeRepoId)?.path ?? null;
const activate = (repo: string | null) => {
  useStatusStore.getState().activateRepo(repo);
  useLogStore.getState().activateRepo(repo);
};
activate(path(useRepoStore.getState()));
const unsubscribe = useRepoStore.subscribe((state, previous) => {
  const next = path(state);
  if (next !== path(previous)) activate(next);
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribe);
