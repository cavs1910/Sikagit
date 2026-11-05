import { randomUUID } from 'crypto';
import type { BranchCleanupBase, BranchCleanupCandidate, BranchCleanupPreview, BranchCleanupResult } from '@sikagit/shared';
import { safeRef } from '../security';
import { getGit, deleteBranch, deleteRemoteBranch, verifyRemoteBranchTip } from './gitService';

const LIMIT = 200;
const TTL = 15 * 60 * 1000;
type Options = { baseRef?: string; includeLocal: boolean; includeRemote: boolean };
type Ref = BranchCleanupCandidate & { branch: string; remote?: string; inUse: boolean };
type Plan = { repo: string; base: BranchCleanupBase; candidates: BranchCleanupCandidate[]; options: Options; expiresAt: number };
const plans = new Map<string, Plan>();

// All entry points are called while holding the existing repository mutex.
async function inspect(repo: string, options: Options) {
  const git = getGit(repo);
  const remotes = (await git.getRemotes()).map(r => r.name).sort((a, b) => b.length - a.length);
  const listing = await git.raw(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)%00%(worktreepath)', 'refs/heads', 'refs/remotes']);
  const refs: Ref[] = [];
  for (const line of listing.split('\n')) {
    const fields = line.split('\0');
    if (fields.length !== 4) continue;
    const [ref, commit, symbolic, worktree] = fields;
    if (symbolic || !/^[a-f0-9]{40,64}$/.test(commit)) continue;
    const isRemote = ref.startsWith('refs/remotes/');
    if (!isRemote && !ref.startsWith('refs/heads/')) continue;
    const short = ref.slice(isRemote ? 'refs/remotes/'.length : 'refs/heads/'.length);
    const remote = isRemote ? remotes.find(r => short.startsWith(r + '/')) : undefined;
    if (isRemote && !remote) continue;
    const branch = remote ? short.slice(remote.length + 1) : short;
    try { safeRef(branch); if (remote) safeRef(remote); } catch { continue; }
    refs.push({ ref, commit, name: isRemote ? `remotes/${short}` : short, isRemote, branch, remote, inUse: !!worktree });
  }
  const bases: BranchCleanupBase[] = refs.filter(r => r.branch === 'main' || r.branch === 'master')
    .map(r => ({ ref: r.ref, name: r.name, commit: r.commit, isRemote: r.isRemote }))
    .sort((a, b) => Number(a.isRemote) - Number(b.isRemote) || Number(a.name.endsWith('master')) - Number(b.name.endsWith('master')) || a.name.localeCompare(b.name));
  const base = options.baseRef ? bases.find(b => b.ref === options.baseRef) : bases.find(b => !options.includeRemote || b.isRemote);
  if (!base) throw new Error('Select an existing main/master branch. Fetch first if the remote branch is missing.');
  if (options.includeRemote && !base.isRemote) throw new Error('Select a remote main/master as the base to clean remote branches. Unpublished local merges are not enough.');
  const baseRemote = refs.find(r => r.ref === base.ref)?.remote;
  const merged = new Map<string, string>();
  const mergedListing = await git.raw(['for-each-ref', `--merged=${base.commit}`, '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/remotes']);
  for (const line of mergedListing.split('\n')) {
    const [ref, commit] = line.split('\0');
    if (ref && commit) merged.set(ref, commit);
  }
  const inUse = new Set(refs.filter(r => !r.isRemote && r.inUse).map(r => r.branch));
  const candidates = refs.filter(r =>
    r.branch !== 'main' && r.branch !== 'master' && !r.inUse && !inUse.has(r.branch) && merged.get(r.ref) === r.commit &&
    (r.isRemote ? options.includeRemote && r.remote === baseRemote : options.includeLocal)
  ).sort((a, b) => Number(a.isRemote) - Number(b.isRemote) || a.name.localeCompare(b.name))
    .map(({ ref, name, commit, isRemote }) => ({ ref, name, commit, isRemote }));
  return { base, bases, candidates };
}

export async function previewBranchCleanup(repo: string, options: Options): Promise<BranchCleanupPreview> {
  if (!options.includeLocal && !options.includeRemote) throw new Error('Select local branches, remote branches, or both.');
  const state = await inspect(repo, options);
  for (const [id, plan] of plans) if (plan.expiresAt <= Date.now()) plans.delete(id);
  if (plans.size >= 100) plans.delete(plans.keys().next().value!);
  const planId = randomUUID(), expiresAt = Date.now() + TTL;
  const candidates = state.candidates.slice(0, LIMIT);
  plans.set(planId, { repo, base: state.base, candidates, options: { ...options, baseRef: state.base.ref }, expiresAt });
  return { planId, expiresAt, base: state.base, bases: state.bases, candidates, totalCandidates: state.candidates.length, limit: LIMIT };
}

export async function executeBranchCleanup(repo: string, planId: string, selected: unknown): Promise<BranchCleanupResult> {
  const plan = plans.get(planId);
  if (!plan || plan.repo !== repo || plan.expiresAt <= Date.now()) throw new Error('Cleanup preview expired. Generate a new preview.');
  if (!Array.isArray(selected) || !selected.length || selected.length > LIMIT || selected.some(r => typeof r !== 'string') || new Set(selected).size !== selected.length) {
    throw new Error('Select each previewed branch at most once.');
  }
  const wanted = selected.map(ref => plan.candidates.find(c => c.ref === ref));
  if (wanted.some(c => !c)) throw new Error('Select only branches from this cleanup preview.');
  const candidates = wanted as BranchCleanupCandidate[];
  const fresh = await inspect(repo, plan.options);
  if (fresh.base.commit !== plan.base.commit || candidates.some(c => !fresh.candidates.some(f => f.ref === c.ref && f.commit === c.commit))) {
    throw new Error('The base, selected branches or checked-out branches changed. Generate a new cleanup preview. Nothing was deleted.');
  }
  // Check the published base before any deletion, including local deletions.
  if (candidates.some(c => c.isRemote)) await verifyRemoteBranchTip(repo, plan.base.name, plan.base.commit);
  plans.delete(planId);
  const results: BranchCleanupResult['results'] = [];
  let stopRemote = false, stopAll = false;
  const started = Date.now();
  for (const branch of candidates) {
    if (stopAll || (stopRemote && branch.isRemote) || Date.now() - started > 120000) {
      results.push({ ...branch, status: 'skipped', message: 'Cleanup stopped. Review the results and generate a new preview.' });
      continue;
    }
    try {
      const baseTip = (await getGit(repo).raw(['show-ref', '--verify', '--hash', plan.base.ref])).trim();
      if (baseTip !== plan.base.commit) {
        stopAll = true;
        throw new Error('The base branch changed during cleanup. Generate a new preview.');
      }
      if (branch.isRemote) await deleteRemoteBranch(repo, branch.name, branch.commit);
      else await deleteBranch(repo, branch.name, false, branch.commit);
      results.push({ ...branch, status: 'deleted' });
    } catch (error) {
      if (branch.isRemote) stopRemote = true;
      let message = error instanceof Error ? error.message : 'Branch deletion failed';
      if (!branch.isRemote && /not fully merged/i.test(message)) message = 'Git kept this branch because it is not merged into its upstream or the current branch. Update/check out main/master and preview again.';
      results.push({ ...branch, status: 'failed', message });
    }
  }
  return { results };
}
