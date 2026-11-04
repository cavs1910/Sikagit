// Small, memory-only caches. Never persist working-tree data in localStorage.
export function rememberRepo<T>(cache: Map<string, T>, repo: string, value: T) {
  cache.delete(repo);
  cache.set(repo, value);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
}
