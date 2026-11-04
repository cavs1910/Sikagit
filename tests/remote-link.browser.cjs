// Run against Vite with mocked API responses; never navigates to a real remote.
const { chromium } = require(process.env.SIKAGIT_BROWSER_CLIENT || 'playwright');
const assert = require('node:assert/strict');
const origin = process.env.SIKAGIT_TEST_ORIGIN || 'http://127.0.0.1:5184';

(async () => {
 const browser = await chromium.launch();
 try {
  for (const width of [390, 1280]) {
   const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: width < 768, isMobile: width < 768 });
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   let remote = '';
   await page.route('**/socket.io/**', route => route.abort());
   await page.route('**/api/v1/**', route => {
    const endpoint = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let data = {};
    if (endpoint === '/auth/session') data = { authenticated: true, expiresAt: Date.now() + 86400000 };
    if (endpoint === '/repos') data = [{ id: 'demo', name: 'Remote link fixture', path: '/repos/demo', displayPath: '/repos/demo' }];
    if (['/projects', '/git/tags', '/git/branches'].includes(endpoint)) data = [];
    if (endpoint === '/git/status') data = { current: 'main', tracking: 'origin/main', upstreamStatus: 'remote', hasRemote: true, remoteUrl: remote, ahead: 0, behind: 0, files: [], staged: [], unstaged: [], untracked: [], conflicted: [] };
    if (endpoint === '/git/graph') data = { commits: [], totalLanes: 0 };
    if (endpoint === '/ai/settings') data = { enabled: false, hasApiKey: false };
    return route.fulfill({ json: { success: true, data } });
   });
   const cases = [
    ['https://github.com/owner/repo.git', 'GitHub', 'https://github.com/owner/repo'],
    ['git@github.com:owner/repo.git', 'GitHub', 'https://github.com/owner/repo'],
    ['https://gitlab.com/group/subgroup/repo.git', 'GitLab', 'https://gitlab.com/group/subgroup/repo'],
    ['ssh://git@bitbucket.org/team/repo.git', 'Bitbucket', 'https://bitbucket.org/team/repo'],
    ['https://codeberg.org/team/repo.git/', 'Codeberg', 'https://codeberg.org/team/repo'],
    ['git@ssh.dev.azure.com:v3/org/project/repo', 'Azure DevOps', 'https://dev.azure.com/org/project/_git/repo'],
    ['https://org.visualstudio.com/project/_git/repo', 'Azure DevOps', 'https://org.visualstudio.com/project/_git/repo'],
    ['https://git.example.test:8443/team/repo.git', 'Git', 'https://git.example.test:8443/team/repo'],
    ['https://fake-user:fake-secret@github.com/owner/repo.git?token=fake-query#fake-fragment', 'GitHub', 'https://github.com/owner/repo'],
    ['https://github.com.evil.test/owner/repo.git', 'Git', 'https://github.com.evil.test/owner/repo'],
   ];
   for (const [url, name, href] of cases) {
    remote = url;
    await page.goto(origin + '/r/demo');
    const link = page.getByRole('link', { name: 'Open repository on ' + name, exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), href);
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match(await link.getAttribute('rel'), /noopener/);
    assert.match(await link.getAttribute('rel'), /noreferrer/);
    assert.equal(await link.innerText(), '');
    assert.equal(await link.locator('svg').count(), 1);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
   }
   const invalid = ['javascript:alert(1)', 'file:///repos/demo', 'ext::sh -c true', 'git@unknown.example.test:team/repo', 'https://github.com', 'https://github.com/team/\nrepo'];
   const results = await page.evaluate(async inputs => {
    const { remoteRepository } = await import('/src/lib/remoteRepository.ts');
    return inputs.map(remoteRepository);
   }, invalid);
   assert(results.every(result => result === null));
   assert.deepEqual(errors, []);
   console.log(`PASS ${width}px: platform logos/links, SSH conversion, nested paths, credential stripping, host identity and invalid schemes`);
   await page.close();
  }
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
