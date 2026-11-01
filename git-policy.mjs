import { execFileSync, spawn } from 'node:child_process';

// Do not execute repository-controlled programs while inspecting or changing a repo.
// Read keys without following config includes, then reject executable configuration.
const args = process.argv.slice(2);
const cwdArgs = [];
let commandIndex = 0;
while (commandIndex < args.length && args[commandIndex].startsWith('-')) {
  const value = args[commandIndex];
  if (value === '-C') { cwdArgs.push(value, args[commandIndex + 1]); commandIndex += 2; }
  else if (value === '-c') commandIndex += 2;
  else commandIndex++;
}
const blocked = /^(?:include\.|includeif\.|filter\.|credential\.|alias\.|gpg\.|diff\..*\.(?:command|textconv)$|merge\..*\.driver$|core\.(?:hookspath|fsmonitor|sshcommand|pager|gitproxy|editor)$|interactive\.difffilter$|sequence\.editor$|http\.|mergetool\..*\.cmd$|pager\.|url\..*\.(?:push)?insteadof$|remote\..*\.(?:uploadpack|receivepack|proxy)$)/i;
try {
  for (const scope of ['--local', '--worktree']) {
    let text;
    try {
      text = execFileSync('/usr/bin/git', [...cwdArgs, 'config', scope, '--no-includes', '--null', '--name-only', '--list'], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      // Git exits 128 outside a repository. No repo config exists to inspect.
      if (err.status === 128) continue;
      throw new Error('Unable to inspect repository configuration');
    }
    if (text.split('\0').filter(Boolean).some(key => blocked.test(key))) throw new Error('Repository-controlled external commands or config includes are disabled');
  }
} catch (err) { console.error(`SikaGit: ${err.message}`); process.exit(1); }
const flags = ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'http.sslVerify=true', '-c', 'log.showSignature=false', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never'];
// Global security settings follow caller options so they cannot be overridden.
const finalArgs = [...args.slice(0, commandIndex), ...flags, ...args.slice(commandIndex)];
if (args[commandIndex] === 'diff') finalArgs.splice(commandIndex + flags.length + 1, 0, '--no-ext-diff', '--no-textconv');
const child = spawn('/usr/bin/git', finalArgs, { stdio: 'inherit', env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no' } });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('SikaGit: unable to start Git'); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 128 : 1)));
