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

These are local observations, not live remote confirmations. Fetch updates the
remote-tracking refs; successful in-app fetch/pull/push operations also reload
the history and status. An external change needs a history refresh. A remote may
have changed without this server knowing. Remote tags alone do not establish
publication because Git does not track their remote provenance here.

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
