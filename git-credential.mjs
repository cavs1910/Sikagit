import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function credentialsFor(input, text) {
  if (input.length > 16384 || text.length > 65536) return null;
  const fields = Object.fromEntries(input.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
  if (fields.protocol !== 'https' || fields.host !== 'github.com') return null;
  const block = text.match(/^github\.com:\r?\n((?:[ \t].*(?:\r?\n|$))*)/m)?.[1];
  if (!block) return null;
  const lines = block.split(/\r?\n/).filter(line => line.trim());
  const indent = Math.min(...lines.map(line => line.match(/^\s*/)[0].length));
  const direct = lines.filter(line => line.match(/^\s*/)[0].length === indent).join('\n');
  const password = direct.match(/^\s*oauth_token:\s*([A-Za-z0-9_]+)\s*$/m)?.[1];
  const username = direct.match(/^\s*user:\s*([A-Za-z0-9-]+)\s*$/m)?.[1];
  return password && username && (!fields.username || fields.username === username) ? { username, password } : null;
}

// Get-only helper: never contact the network, persist tokens, or return a
// GitHub token for HTTP, an alternate host, or another requested account.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== 'get') process.exit(0);
  try {
    const result = credentialsFor(fs.readFileSync(0, 'utf8'), fs.readFileSync('/run/gh/hosts.yml', 'utf8'));
    if (result) process.stdout.write(`username=${result.username}\npassword=${result.password}\n\n`);
  } catch { process.exit(1); }
}
