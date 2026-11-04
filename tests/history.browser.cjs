// Run against Vite with mocked API responses; no real repos or AI calls.
const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:5184';

(async () => {
 const browser = await chromium.launch();
 try {
  for (const width of [390, 1280]) {
   const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 768, isMobile: width < 768 });
   const errors = [], calls = [];
   page.on('pageerror', error => errors.push(error.message));
   const normal = Array.from({ length: 201 }, (_, i) => ({
    hash: (i + 1).toString(16).padStart(40, '0'), abbreviatedHash: String(i + 1),
    authorName: 'Fixture', authorEmail: 'fixture@example.invalid', authorDate: '2026-11-04T12:00:00Z',
    message: `Branch commit ${i}`, body: '', parentHashes: [], branches: i === 0 ? ['main'] : [],
    tags: [], isHead: i === 0, publication: 'published', lane: 0, laneColor: 0, connections: [],
   }));
   const recovered = { ...normal[0], hash: 'f'.repeat(40), message: 'Reflog-only commit', branches: [], isHead: false, publication: 'local' };
   let holdNext = false, held, release;
   await page.route('**/socket.io/**', route => route.abort());
   await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname.replace('/api/v1', '');
    let data = {};
    if (endpoint === '/repos') data = [{ id: 'demo', name: 'History fixture', path: '/repos/demo', displayPath: '/repos/demo' }];
    if (['/projects', '/git/tags', '/git/commit-files'].includes(endpoint)) data = [];
    if (endpoint === '/git/branches') data = [{ name: 'main', current: true, isRemote: false, commit: normal[0].hash }];
    if (endpoint === '/git/status') data = { current: 'main', tracking: null, upstreamStatus: 'none', hasRemote: false, ahead: 0, behind: 0, files: [], staged: [], unstaged: [], untracked: [], conflicted: [] };
    if (endpoint === '/ai/settings') data = { enabled: false, hasApiKey: false };
    if (endpoint === '/auth/session') data = { authenticated: true, expiresAt: Date.now() + 86400000 };
    if (endpoint.includes('diff')) data = { diff: '', suppressed: [] };
    if (endpoint === '/git/graph') {
     const mode = url.searchParams.get('showReflog') === 'true';
     const skip = Number(url.searchParams.get('skip')), limit = Number(url.searchParams.get('limit'));
     calls.push({ mode, skip, limit });
     data = { commits: (mode ? [recovered, ...normal] : normal).slice(skip, skip + limit), totalLanes: 1 };
     if (holdNext) {
      holdNext = false;
      await new Promise(resolve => { release = resolve; held = true; });
     }
    }
    await route.fulfill({ json: { success: true, data } });
   });
   // Read the actual store through Vite to inspect pagination and stale responses.
   const state = () => page.evaluate(async () => {
    const { useLogStore } = await import('/src/store/logStore.ts');
    const s = useLogStore.getState();
    return { hashes: s.commits.map(c => c.hash), loading: s.loading, selected: s.selectedCommit, mode: s.loadedShowReflog, hasMore: s.hasMore };
   });
   const loadMore = () => page.evaluate(async () => {
    const { useLogStore } = await import('/src/store/logStore.ts');
    void useLogStore.getState().loadMore('/repos/demo');
   });
   const waitFor = async predicate => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(r => setTimeout(r, 30)); }
    throw new Error('Timed out waiting for history state');
   };
   await page.goto(origin + '/r/demo');
   const toggle = page.getByRole('switch', { name: 'Show reflog' });
   await toggle.waitFor();
   await waitFor(async () => (await state()).hashes.length === 200);
   assert.equal(await toggle.getAttribute('aria-checked'), 'false');
   assert.deepEqual(calls[0], { mode: false, skip: 0, limit: 200 });
   assert.equal((await state()).hashes.includes(recovered.hash), false);

   // An old-mode page arriving after the toggle must never append to the new graph.
   holdNext = true; held = false;
   await loadMore(); await waitFor(() => held);
   assert.deepEqual(calls.at(-1), { mode: false, skip: 200, limit: 200 });
   await toggle.click();
   await waitFor(async () => (await state()).mode && !(await state()).loading);
   release(); await new Promise(r => setTimeout(r, 150));
   assert.equal((await state()).hashes.length, 200);
   await page.getByText('Reflog-only commit', { exact: true }).waitFor();
   assert.equal(await page.getByRole('img', { name: 'Only local', exact: true }).count(), 1);
   await loadMore(); await waitFor(async () => (await state()).hashes.length === 202);
   assert.deepEqual(calls.at(-1), { mode: true, skip: 200, limit: 200 });
   assert.equal((await state()).hasMore, false);

   // Persistence uses the same UI settings as the other controls.
   await page.reload(); await toggle.waitFor();
   await waitFor(async () => (await state()).mode && !(await state()).loading);
   assert.equal(await toggle.getAttribute('aria-checked'), 'true');
   assert.deepEqual(calls.at(-1), { mode: true, skip: 0, limit: 200 });
   await page.evaluate(async hash => {
    const { useLogStore } = await import('/src/store/logStore.ts');
    useLogStore.getState().selectCommit(hash);
   }, recovered.hash);
   if (width < 768) await page.getByRole('button', { name: 'Back to history' }).click();
   holdNext = true; held = false;
   await toggle.click(); await waitFor(() => held);
   const cleared = await state();
   assert.deepEqual(cleared.hashes, []); assert.equal(cleared.selected, null);
   assert.deepEqual(calls.at(-1), { mode: false, skip: 0, limit: 200 });
   release(); await waitFor(async () => !(await state()).loading);
   assert.equal(await page.getByText('Reflog-only commit', { exact: true }).count(), 0);
   await page.getByText('Branch commit 0', { exact: true }).waitFor();
   await page.reload(); await toggle.waitFor();
   await waitFor(async () => !(await state()).loading);
   assert.equal(await toggle.getAttribute('aria-checked'), 'false');
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   assert.deepEqual(errors, []);
   console.log(`PASS ${width}px: default, toggle, pagination, stale response, selection, publication and persistence`);
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
