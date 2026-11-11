// Disposable UI fixture: no repository files or AI/network calls are used.
const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:5184';
const content = 'function fixture() {\n  return "' + 'long text '.repeat(45) + '";\n}\n';
(async () => {
 const browser = await chromium.launch();
 try { for (const width of [320, 390, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: width < 768 });
  page.setDefaultTimeout(10000);
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
   if (!localStorage.getItem('sikagit-ui')) localStorage.setItem('sikagit-ui', JSON.stringify({ version: 4, state: { autoFetchOnOpen: false } }));
  });
  await page.route('**/socket.io/**', r => r.abort());
  await page.route('**/api/v1/**', async route => {
   const request = route.request(), url = new URL(request.url()), part = url.pathname.replace('/api/v1', '');
   let data = {};
   // The sidebar's explicit status refresh is a read-only POST.
   if (request.method() !== 'GET' && part !== '/git/status-summary/refresh') writes.push(part);
   if (part === '/repos') data = [{ id: 'fixture', name: 'Fixture', path: '/repos/fixture', displayPath: '/repos/fixture' }];
   if (part === '/projects') data = [];
   if (part === '/auth/session') data = { authenticated: true, expiresAt: Date.now() + 86400000 };
   if (part === '/ai/settings') data = { enabled: false, hasApiKey: false };
   if (part === '/git/status') data = { current: 'main', files: [], staged: [], unstaged: [], untracked: [], conflicted: [], hasRemote: false, ahead: 0, behind: 0 };
   if (part === '/git/branches') data = [{ name: 'main', current: true, isRemote: false, commit: 'a'.repeat(40) }];
   if (part === '/git/tags') data = [];
   if (part === '/git/graph') data = { totalLanes: 0, commits: [] };
   if (part === '/editor/tree') data = ['fixture.js', 'other.txt'].map(name => ({ name, path: name, type: 'file' }));
   if (part === '/editor/file') data = { content, revision: 'r1', lineEnding: 'lf' };
   await route.fulfill({ json: { success: true, data } });
  });
  const openFile = async (name) => {
   if (width < 768 && await page.getByTitle('Show explorer', { exact: true }).count()) await page.getByTitle('Show explorer', { exact: true }).click();
   await page.getByRole('button', { name, exact: true }).click();
   await page.locator('.cm-content').waitFor();
  };
  await page.goto(origin + '/r/fixture');
  await page.getByRole('tab', { name: 'Files', exact: true }).click();
  await openFile('fixture.js');
  const editor = page.locator('.cm-content'), size = page.getByLabel('Editor text size', { exact: true }), wrap = page.getByRole('button', { name: 'Word wrap', exact: true });
  const actualSize = () => page.locator('.cm-scroller').evaluate(e => getComputedStyle(e).fontSize);
  const action = async (name) => {
   await page.getByRole('button', { name: 'Editor actions', exact: true }).click();
   await page.getByRole('menuitem', { name, exact: true }).click();
  };
  assert.equal(await actualSize(), '13px');
  assert.equal(await wrap.getAttribute('aria-pressed'), 'false');
  // Appearance changes must preserve a draft and its undo history.
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('draft');
  const before = await editor.innerText();
  await size.selectOption('24'); await wrap.click();
  assert.equal(await actualSize(), '24px');
  assert.equal(await editor.innerText(), before);
  assert.equal(await editor.evaluate(e => getComputedStyle(e).whiteSpace), 'break-spaces');
  assert(await page.locator('.cm-scroller').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  // Menu commands run after Radix closes and hands focus back to CodeMirror.
  await action('Undo');
  await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('draft'));
  await action('Redo');
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('draft'));
  await page.getByRole('button', { name: 'Find and replace', exact: true }).click();
  const search = page.locator('.cm-search input[name="search"]'); await search.fill('return');
  assert(await search.evaluate(e => e === document.activeElement));
  await page.locator('.cm-search input[name="replace"]').fill('changed');
  await page.locator('.cm-search button[name="replaceAll"]').click();
  assert((await editor.innerText()).includes('changed'));
  assert(!(await editor.innerText()).includes('return'));
  await page.keyboard.press('Escape');
  await action('Go to line…');
  const line = page.locator('.cm-panel input[name="line"]'); await line.fill('2'); await line.press('Enter');
  assert.equal(await page.locator('.cm-lineNumbers .cm-activeLineGutter').innerText(), '2');
  // Let the lazy JavaScript parser load before requesting folds.
  await page.locator('.cm-foldGutter [title="Fold line"]').first().waitFor();
  await action('Fold all'); await page.locator('.cm-foldPlaceholder').waitFor();
  await action('Unfold all'); await page.locator('.cm-foldPlaceholder').waitFor({ state: 'hidden' });
  await openFile('other.txt'); assert.equal(await actualSize(), '24px'); assert.equal(await wrap.getAttribute('aria-pressed'), 'true');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  // Discard only this disposable draft before checking reload persistence.
  await page.getByRole('button', { name: 'Close fixture.js', exact: true }).click();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await page.reload(); await page.getByRole('tab', { name: 'Files', exact: true }).click(); await openFile('fixture.js');
  assert.equal(await actualSize(), '24px'); assert.equal(await wrap.getAttribute('aria-pressed'), 'true');
  await size.selectOption('10'); assert.equal(await actualSize(), '10px'); await wrap.click();
  assert.equal(await editor.evaluate(e => getComputedStyle(e).whiteSpace), 'pre');
  // Radix keyboard navigation and focus return on Escape.
  const menu = page.getByRole('button', { name: 'Editor actions', exact: true });
  await menu.focus(); await page.keyboard.press('Enter'); await page.getByRole('menu').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Editor actions');
  console.log(`PASS ${width}px: text size, wrapping, draft/undo preservation, menu commands, focus, persistence and no writes`);
  await page.close();
 }} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
