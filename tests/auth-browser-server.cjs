// Disposable server for auth.browser.cjs. Never mount real repositories/secrets.
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync('/tmp/sikagit-auth-browser-');
const repo = path.join(root, 'repos/demo');fs.mkdirSync(repo, { recursive: true });
const auth = path.join(root, 'auth.json');
fs.writeFileSync(auth, JSON.stringify({ username: 'fixture', password: 'browser-fixture-only-not-a-real-password' }));
Object.assign(process.env, { PROJECTS_ROOT: path.join(root, 'repos'), DATA_DIR: path.join(root, 'data'), AUTH_FILE: auth, PUBLIC_ORIGIN: 'http://127.0.0.1:18890', PORT: '3001' });
const git = (...args) => execFileSync('/usr/bin/git', ['-C', repo, ...args], { stdio: 'ignore' });
git('init', '-q', '-b', 'main');git('config', 'user.name', 'Fixture');git('config', 'user.email', 'fixture@example.invalid');
fs.writeFileSync(path.join(repo, 'draft.txt'), 'original\n');git('add', '.');git('commit', '-qm', 'fixture');
const { insertRepo } = require('/app/server/dist/server/src/services/db.js');
insertRepo({ id: 'demo', path: repo, displayPath: '/fixture/demo', name: 'Demo', isWSL: false, lastOpened: new Date().toISOString(), slowMode: false, lastTimedOutAt: null });
require('/app/server/dist/server/src/index.js');
