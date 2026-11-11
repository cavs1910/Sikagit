// Disposable UI fixture: no repository files or AI/network calls are used.
const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:5184';
const content = '// Fixture\nfunction fixture() {\n  return "' + 'long text '.repeat(45) + '";\n}\n' + Array.from({length: 160}, (_, i) => '// Fixture line ' + (i + 1)).join('\n');
(async () => {
 const browser = await chromium.launch();
 try { for (const width of [320, 390, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: width < 768 });
  page.setDefaultTimeout(10000);
  const errors = [], writes = [];
  let readFailures = 1;
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
   if (part === '/editor/tree') data = ['fixture.js', 'other.txt', 'unavailable.txt'].map(name => ({ name, path: name, type: 'file' }));
   if (part === '/editor/file' && url.searchParams.get('file') === 'unavailable.txt' && readFailures-- > 0) {
    await route.fulfill({ status: 400, json: { success: false, error: 'Fixture read error' } }); return;
   }
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
  const editor = page.locator('.cm-content');
  const openMenu = () => page.getByRole('button', { name: 'Editor actions', exact: true }).click();
  const setSize = async (value) => {
   await openMenu();
   const current = parseInt(await page.getByRole('status', { name: 'Editor text size', exact: true }).innerText());
   const control = page.getByRole('menuitem', { name: Number(value) > current ? 'Increase text size' : 'Decrease text size', exact: true });
   for (let i = 0; i < Math.abs(Number(value) - current); i++) await control.click();
   await page.keyboard.press('Escape');
  };
  const toggleWrap = async () => {
   await openMenu();
   await page.getByRole('menuitemcheckbox', { name: 'Word wrap', exact: true }).click();
  };
  const actualSize = () => page.locator('.cm-scroller').evaluate(e => getComputedStyle(e).fontSize);
  const action = async (name) => {
   await page.getByRole('button', { name: 'Editor actions', exact: true }).click();
   await page.getByRole('menuitem', { name, exact: true }).click();
  };
  assert.equal(await actualSize(), '13px');
  assert(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled());
  assert.equal(await editor.evaluate(e => getComputedStyle(e).whiteSpace), 'pre');
  const toolbar = page.locator('.editor-tabbar'), codeArea = page.locator('.code-editor');
  assert((await toolbar.boundingBox()).height <= 43);
  assert.equal(await codeArea.evaluate(e => Math.round(e.getBoundingClientRect().top - document.querySelector('.editor-tabbar').getBoundingClientRect().bottom)), 0);
  assert.equal(await page.getByText('Text size', { exact: true }).count(), 0);
  if (width < 768) {
   const main = page.locator('.repository-content');
   assert(await main.evaluate(e => e.scrollHeight > e.clientHeight + 30));
   await main.evaluate(e => { e.scrollTop = 0; });
   await page.locator('.workspace-tabs').hover(); await page.mouse.wheel(0, 250);
   await page.waitForFunction(() => document.querySelector('.repository-content').scrollTop > 30);
   await main.evaluate(e => { e.scrollTop = e.scrollHeight; });
   const header = await page.locator('header').boundingBox();
   assert(Math.abs((await toolbar.boundingBox()).y - header.height) < 2);
   assert((await codeArea.boundingBox()).height > 844 * .8);
   // Emulate iOS: the keyboard shrinks visualViewport, not innerHeight.
   await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 350 });
    visualViewport.dispatchEvent(new Event('resize'));
   });
   assert.equal(await page.evaluate(() => innerHeight), 844);
   await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-viewport-height')) <= 350);
   await main.evaluate(e => { e.scrollTop = e.scrollHeight; });
   assert((await codeArea.boundingBox()).height >= 200);
   assert((await codeArea.boundingBox()).y + (await codeArea.boundingBox()).height <= 350);
   assert.equal(Math.round((await page.locator('.app-shell').boundingBox()).height), 350);
   await editor.focus();
   assert(await editor.evaluate(e => e === document.activeElement));
   await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
  }
  // Both the file content and upper chrome have reachable scroll containers.
  await page.locator('.cm-scroller').evaluate(e => { e.scrollTop = 500; });
  await page.waitForFunction(() => document.querySelector('.cm-scroller').scrollTop > 100);
  await page.locator('.cm-scroller').evaluate(e => { e.scrollTop = 0; });
  // Appearance changes must preserve a draft and its undo history.
  await editor.click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('End'); await page.keyboard.type('draft');
  assert((await editor.innerText()).includes('draft'));
  await setSize('24'); await toggleWrap();
  assert.equal(await actualSize(), '24px');
  assert((await editor.innerText()).includes('draft'));
  assert.equal(await editor.evaluate(e => getComputedStyle(e).whiteSpace), 'break-spaces');
  assert(await page.locator('.cm-scroller').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  await editor.evaluate(e => { window.fixtureEditorElement = e; });
  await page.getByRole('button', { name: 'Expand editor', exact: true }).click();
  assert.equal(Math.round((await page.locator('.editor-expanded').boundingBox()).y), 0);
  assert((await codeArea.boundingBox()).height > 844 * .9);
  assert(await editor.evaluate(e => e === window.fixtureEditorElement));
  assert((await editor.innerText()).includes('draft'));
  await openMenu(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.editor-expanded').count(), 1);
  await action('Reload from server…');
  await page.getByRole('button', { name: 'Discard draft and reload', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel', exact: true }).press('Escape');
  assert.equal(await page.locator('.editor-expanded').count(), 1);
  assert((await editor.innerText()).includes('draft'));
  assert(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Exit expanded editor', exact: true }).press('Escape');
  await page.locator('.editor-expanded').waitFor({ state: 'hidden' });
  // Menu commands run after Radix closes and hands focus back to CodeMirror.
  await action('Undo');
  await page.waitForFunction(() => !document.querySelector('.cm-content').innerText.includes('draft'));
  await action('Redo');
  await page.waitForFunction(() => document.querySelector('.cm-content').innerText.includes('draft'));
  if (width < 768) await action('Find / replace…');
  else await page.getByRole('button', { name: 'Find and replace', exact: true }).click();
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
  await openFile('other.txt'); assert.equal(await actualSize(), '24px'); assert.equal(await editor.evaluate(e => getComputedStyle(e).whiteSpace), 'break-spaces');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  // Discard only this disposable draft before checking reload persistence.
  await page.getByRole('button', { name: 'Close fixture.js', exact: true }).click();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await page.reload(); await page.getByRole('tab', { name: 'Files', exact: true }).click(); await openFile('fixture.js');
  assert.equal(await actualSize(), '24px'); assert.equal(await editor.evaluate(e => getComputedStyle(e).whiteSpace), 'break-spaces');
  await setSize('10'); assert.equal(await actualSize(), '10px'); await toggleWrap();
  assert.equal(await editor.evaluate(e => getComputedStyle(e).whiteSpace), 'pre');
  // Radix keyboard navigation and focus return on Escape.
  const menu = page.getByRole('button', { name: 'Editor actions', exact: true });
  await menu.focus(); await page.keyboard.press('Enter'); await page.getByRole('menu').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Editor actions');
  await page.getByRole('button', { name: 'Expand editor', exact: true }).click();
  await page.getByRole('button', { name: 'Close fixture.js', exact: true }).click();
  await page.locator('.editor-expanded').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'unavailable.txt', exact: true }).click();
  await page.getByText('Fixture read error', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reload from server', exact: true }).click();
  await editor.waitFor();
  if (width < 768) await page.getByTitle('Show explorer', { exact: true }).click();
  await page.getByRole('button', { name: 'fixture.js', exact: true }).click();
  await editor.waitFor();
  if (process.env.SIKAGIT_EDITOR_PREVIEW_DIR) {
   await setSize('14'); await toggleWrap();
   if (width >= 768) await openMenu();
   await page.screenshot({ path: process.env.SIKAGIT_EDITOR_PREVIEW_DIR + '/editor-' + width + '.png' });
  }
  console.log(`PASS ${width}px: compact toolbar, chrome/content scrolling, visual viewport, expansion, preferences, commands, drafts and no writes`);
  await page.close();
 }} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
