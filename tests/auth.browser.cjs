const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:18890';
const password = 'browser-fixture-only-not-a-real-password';
async function waitFor(predicate) {
 for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
 throw new Error('Timed out waiting for intercepted authentication request');
}

(async () => {
 const browser = await chromium.launch();
 try {
  for (const width of [390, 1280]) {
   let context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768, isMobile: width < 768 });
   let page = await context.newPage();
   const errors = [];
   page.on('pageerror', e => errors.push(e.message));
   const signIn = async (value = password) => {
    await page.getByLabel('Username', { exact: true }).fill('fixture');
    await page.getByLabel('Password', { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
   };
   const shell = () => page.getByRole('tab', { name: 'History & Changes' });
   await page.goto(origin + '/r/demo');
   await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
   assert.equal(await shell().count(), 0);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   await signIn('wrong');await page.getByRole('alert').getByText('Incorrect username or password').waitFor();
   await signIn();await shell().waitFor();
   let cookies = await context.cookies();
   const session = cookies.find(c => c.name === 'sikagit_session_v2');
   assert(session.httpOnly);assert.equal(session.sameSite, 'Strict');
   assert(Math.abs(session.expires - Date.now() / 1000 - 365 * 86400) < 5);
   assert.equal(await page.evaluate(() => document.cookie.includes('sikagit_session_v2')), false);
   assert.equal(await page.evaluate(p => Object.values(localStorage).some(v => v.includes(p)), password), false);
   await page.reload();await shell().waitFor();
   // Reopening in an independent browser context carrying only persistent
   // cookies approximates Home Screen cookie transfer; no Basic credentials.
   const storage = await context.storageState();
   await context.close();
   context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 768, isMobile: width < 768, storageState: { cookies: storage.cookies, origins: [] } });
   page = await context.newPage();page.on('pageerror', e => errors.push(e.message));
   page.on('dialog', dialog => dialog.accept());
   await page.goto(origin + '/r/demo');await shell().waitFor();

   await page.getByRole('tab', { name: 'Files', exact: true }).click();
   await page.getByRole('button', { name: 'draft.txt', exact: true }).click();
   const editor = page.locator('.cm-content');await editor.waitFor();
   await editor.fill('unsaved authentication draft');
   // Revoke the session from another tab, then resume the app: it must show
   // login while retaining the mounted editor and its unsaved draft.
   const logout = await context.request.post(origin + '/api/v1/auth/logout', { data: {}, headers: { Origin: origin } });assert(logout.ok());
   await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
   await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
   assert.equal(await editor.count(), 1);assert.equal(await editor.isVisible(), false);
   await signIn();await editor.waitFor();
   assert.match(await editor.innerText(), /unsaved authentication draft/);

   // A 401 body may be plain text when returned by a proxy; the client must
   // still display login rather than failing JSON parsing or going blank.
   await page.route('**/api/v1/git/status?*', route => route.fulfill({ status: 401, contentType: 'text/plain', body: 'Authentication required' }));
   await page.getByRole('tab', { name: 'History & Changes' }).click();
   await page.evaluate(() => window.dispatchEvent(new Event('focus')));
   await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
   await page.unroute('**/api/v1/git/status?*');
   await signIn();await shell().waitFor();
   const currentSession = (await context.cookies()).find(c => c.name === 'sikagit_session_v2');
   if (width < 768) await page.getByRole('button', { name: 'Open repositories' }).click();
   await page.getByTitle('App Settings', { exact: true }).click();
   // A session check begun while logout is in flight must not restore a stale
   // authenticated result after the logout response has completed.
   let releaseLogout, releaseCheck;
   await page.route('**/api/v1/auth/logout', async route => {
    await new Promise(resolve => { releaseLogout = resolve; });
    await route.continue();
   });
   await page.route('**/api/v1/auth/session', async route => {
    const response = await route.fetch();
    await new Promise(resolve => { releaseCheck = resolve; });
    await route.fulfill({ response });
   });
   await page.getByRole('button', { name: 'Sign out', exact: true }).click();
   await waitFor(() => releaseLogout);
   await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
   await waitFor(() => releaseCheck);
   releaseLogout();
   await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
   releaseCheck();await new Promise(resolve => setTimeout(resolve, 150));
   assert(await page.getByRole('button', { name: 'Sign in', exact: true }).isVisible());
   await page.unroute('**/api/v1/auth/logout');await page.unroute('**/api/v1/auth/session');
   const replay = await context.request.get(origin + '/api/v1/repos', { headers: { Cookie: currentSession.name + '=' + currentSession.value } });assert.equal(replay.status(), 401);
   await context.clearCookies();
   await page.route('**/api/v1/auth/session', route => route.abort());
   await page.goto(origin);
   await page.getByRole('button', { name: 'Retry connection' }).waitFor();
   await page.unroute('**/api/v1/auth/session');
   await page.getByRole('button', { name: 'Retry connection' }).click();
   await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
   assert.deepEqual(errors, []);
   console.log(`PASS ${width}px: form login, persistent cookies, reload/reopen, draft preservation, plain-text 401, logout and network retry`);
   await context.close();
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
