export type GitPlatform = 'github' | 'gitlab' | 'bitbucket' | 'codeberg' | 'azure' | 'git';

/** Build a browser link from a Git remote, without forwarding credentials or
 * query parameters. Platform branding depends on the hostname, never substrings. */
export function remoteRepository(remote: string): { platform: GitPlatform; name: string; href: string } | null {
  const raw = remote.trim();
  if (!raw || /[\x00-\x20\x7f\\]/.test(raw)) return null;
  let url: URL;
  try {
    if (/^(https|ssh):\/\//i.test(raw)) {
      url = new URL(raw);
    } else {
      const scp = raw.match(/^(?:[^@/:]+@)?([^/:]+):(.+)$/);
      if (!scp || scp[2].startsWith('/')) return null;
      url = new URL(`ssh://${scp[1]}/${scp[2]}`);
    }
  } catch { return null; }
  const host = url.hostname.toLowerCase();
  let path = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  if (!path || path === '/') return null;
  const platforms: Record<string, { platform: GitPlatform; name: string }> = {
    'github.com': { platform: 'github', name: 'GitHub' },
    'www.github.com': { platform: 'github', name: 'GitHub' },
    'gitlab.com': { platform: 'gitlab', name: 'GitLab' },
    'bitbucket.org': { platform: 'bitbucket', name: 'Bitbucket' },
    'codeberg.org': { platform: 'codeberg', name: 'Codeberg' },
    'dev.azure.com': { platform: 'azure', name: 'Azure DevOps' },
  };
  let platform = platforms[host];
  let webHost = host === 'www.github.com' ? 'github.com' : host;
  if (host === 'ssh.dev.azure.com') {
    const parts = path.split('/').filter(Boolean);
    if (parts.length !== 4 || parts[0] !== 'v3') return null;
    path = `/${parts[1]}/${parts[2]}/_git/${parts[3]}`;
    webHost = 'dev.azure.com';
    platform = platforms['dev.azure.com'];
  } else if (/^[a-z0-9-]+\.visualstudio\.com$/.test(host)) {
    platform = platforms['dev.azure.com'];
  }
  // Self-hosted HTTPS remotes get a generic Git icon: their platform cannot be
  // reliably inferred from the hostname. Unknown SSH web addresses are omitted.
  if (!platform && url.protocol !== 'https:') return null;
  const link = new URL(`https://${webHost}`);
  if (!platform) link.port = url.port;
  link.pathname = path;
  return { ...(platform || { platform: 'git' as const, name: 'Git' }), href: link.href };
}
