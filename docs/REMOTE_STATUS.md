# Branch and commit publication indicators

The repository toolbar shows a static cloud indicator beside Push:

- **Up to date**: the branch matches its known remote upstream.
- **N unpushed** / **N to pull**: ahead/behind counts relative to that upstream.
  Diverged branches display both counts.
- **No upstream**: no tracking relationship is configured. This does not mean
  that every commit is unpublished; another remote branch may contain them.
- **No remote**, **Upstream missing**, **Local upstream**, **Detached HEAD**, or
  **Status unknown** distinguish cases where remote synchronization cannot be
  inferred from ahead/behind counts.

Each history row has an accessible cloud icon with a tooltip. Commit details
also show the label:

- **Published**: reachable from at least one local remote-tracking branch,
  including a branch on a different remote.
- **Only local**: not found in the known remote-tracking history.
- **Publication unknown**: the check failed or exceeded its bounded traversal.

In **History & Changes**, the **Show reflog** switch beside the workspace tabs
is off by default. The normal view
uses `git log --all`, showing history reachable from current refs (including
local branches, remote-tracking branches and tags). Enable the switch to also
include commits recoverable from reflogs, such as commits replaced by squash or
rebase. Those commits can correctly show **Only local**. The preference is saved
in the existing browser UI settings (`sikagit-ui`) across reloads. Changing it
clears the cached history, selection and pagination, discards pending history
responses, and reloads the graph from the first page. Subsequent refreshes and
pages keep the chosen mode. Both `/git/log` and `/git/graph` accept
`showReflog=true`; an omitted parameter defaults to false. This only changes the
view: it never deletes or expires reflogs, commits or branches.

These are local observations, not live remote confirmations. Fetch updates the
remote-tracking refs; successful in-app fetch/pull/push operations also reload
the history and status. An external change needs a history refresh. A remote may
have changed without this server knowing. Remote tags alone do not establish
publication because Git does not track their remote provenance here.

Repository selection synchronously swaps the visible Git state before the next
render. The browser keeps memory-only caches for up to eight repositories;
history caches retain at most 1,000 commits and restore pagination. Returning to
a repository shows its own cached status, refs and history while refreshing;
without a cache it shows loading. Selections reset, editor drafts stay keyed by
repository, and optimistic staging state is isolated per repository. Replies
from a repository left in the background can update only that repository's
cache. Newer requests supersede older requests for the same data, including
status, branches, tags, history and selected commit files. These caches never
replace a network refresh or persist repository contents in localStorage.

The server classifies a requested page with a batch `rev-list` walk that excludes
all remote-tracking history. This detects ancestors even when the remote tip is
outside the visible page. It does not make a network request or launch Git per
commit. The publication check accepts at most 500 exact object IDs, limits the
walk to 10,001 results and uses a two-second Git idle timeout. An incomplete walk
keeps unclassified commits unknown rather than marking them published. With no
remote-tracking refs, known log commits are local. There are no additional timers
or continuous indicator animations.

Validation uses disposable repositories without network access: remote ancestors
outside a page, local tags, multiple remotes, reflog-only commits, missing objects,
invalid arguments, batch limits, upstream removal, divergence, local upstreams and
detached HEAD. Browser fixtures exercise branch states, row/detail labels and
last-Fetch tooltips on desktop and mobile without real Git writes.

Run the Git/API fixtures with `sh scripts/test-security.sh`. For the history UI
fixture, start Vite with `npm run dev -w client -- --host 127.0.0.1 --port 5184`
and run `node tests/history.browser.cjs` with Playwright and Chromium available.
`SIKAGIT_BROWSER_CLIENT` can point to an existing Playwright module or browser
client, and `SIKAGIT_TEST_ORIGIN` overrides the Vite URL. This fixture mocks all
API responses and checks the switch on mobile/desktop, saved preferences,
pagination reset, selection clearing and rejection of a stale page response.


## Repository website link

The toolbar shows the remote host’s logo as an icon-only link beside publication
status. It opens the repository website in a new tab. GitHub, GitLab, Bitbucket,
Codeberg and Azure DevOps have platform logos; self-hosted HTTPS remotes use a
neutral Git logo because their platform cannot be inferred reliably. Known-host
SSH/scp remotes are converted to website URLs, including Azure DevOps SSH paths.
Unknown SSH hosts and unsupported transports have no inferred website link.
Credentials and query/fragment parameters are never included in the browser link.

This visual detection does not enable a new Git integration. This private
installation only allows configuring HTTPS GitHub remote URLs through the app,
and its credential helper only supplies GitHub credentials to github.com. Local
Git/editor features can work on repositories from other hosts; authenticated
fetch/push support needs separately reviewed host credentials and policy changes.
