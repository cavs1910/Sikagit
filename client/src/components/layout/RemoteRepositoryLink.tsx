import { SiGithub, SiGitlab, SiBitbucket, SiCodeberg, SiGit } from 'react-icons/si';
import { VscAzureDevops } from 'react-icons/vsc';
import { remoteRepository } from '../../lib/remoteRepository';

const icons = { github: SiGithub, gitlab: SiGitlab, bitbucket: SiBitbucket, codeberg: SiCodeberg, azure: VscAzureDevops, git: SiGit };

export function RemoteRepositoryLink({ remote }: { remote?: string }) {
  const repository = remote ? remoteRepository(remote) : null;
  if (!repository) return null;
  const Icon = icons[repository.platform];
  return <a
    href={repository.href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`Open repository on ${repository.name}`}
    title={`Open repository on ${repository.name}`}
    className="inline-flex shrink-0 items-center justify-center rounded p-2 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
  >
    <Icon size={16} aria-hidden="true" />
  </a>;
}
