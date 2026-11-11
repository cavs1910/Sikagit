# Mobile layout

Below 768 CSS pixels, SikaGit uses a repository drawer instead of the desktop
sidebar. Selecting a repository, pressing Escape or tapping the backdrop closes
it. Desktop sidebar visibility and saved panel sizes remain independent.

The mobile header uses the space beside the drawer button for the repository
name, branch selector and repository Settings button. Long names truncate.
**Remove repository** is inside Settings and requires confirmation; it removes
only the bookmark, preserving files on disk. Desktop uses the same controls.
The workspace tab bar contains **Show reflog** for History & Changes and the
matching **Show Git-ignored files** switch for Files. On mobile, the visible labels are shortened to **Git**, **Reflog** and **Ignored** while their accessible names remain complete.

The branch picker has one **Merge…** entry, beside **Clean up…** in a compact
footer. Clean up retains its full accessible label and tooltip,
**Clean up merged branches…**. The branch list scrolls independently; actions
stay visible. Detached HEAD and fewer than two local branches disable Merge.

The unified **Merge branches** dialog has a **From** source card above an
**Into** destination card. Both selectors contain local branches only, including
the current branch, and display each selected commit. Any two distinct local
branches can be merged; neither has to be the active branch. By default, a
feature branch merges into main/master when available. When main/master is
active, another local branch is the source and the current branch is the
destination. History/context-menu preselection keeps that branch as source.

The central arrow button reverses direction. Drag either card's grip onto the
other card to do the same with mouse, pen or touch. Releasing outside the other
card or cancelling a touch gesture leaves the selection unchanged. Keyboard
users can activate the central button or press Enter/Space on a grip (ArrowDown
on the source grip and ArrowUp on the destination grip also swap). Selecting a
branch already used on the other card swaps the pair, keeping the two branches
distinct. Selection, swapping, dragging and command review never execute Git.

**Allow fast-forward** uses the shared switch, enabled by default: `--ff` uses
fast-forward when possible and an ordinary merge commit otherwise. Disabling it
uses `--no-ff`, creating a merge commit even when FF is possible (already-merged
histories remain a no-op). This is not FF-only and overrides `merge.ff` for the
operation. **Delete source branch after merge** stays off by default and resets
to off whenever the source changes. It deletes the reviewed source tip only
after success, never forces deletion, and keeps remote branches.

Only the **Merge** button submits the operation. `/git/merge-branches` binds the
request to the reviewed active branch, source commit and destination commit.
Under the repository mutex, the server rejects stale refs, invalid/nonlocal or
equal branches, detached/unborn HEAD, dirty/partially staged work and an existing
merge before switching or modifying files. It switches to the destination only
when needed and merges the fully qualified local source ref, avoiding same-name
tag ambiguity. It stays on the destination after success, conflicts or a
non-conflict merge failure; abort also stays there and closes the dialog. No
push occurs. The older `/merge` and `/merge-to` endpoints remain compatible;
the UI uses only the unified endpoint.

Controls and grips are disabled while merging or resolving conflicts. The
command disclosure follows the selected direction, omits an unnecessary switch
when the destination is current, and changes to `git merge --abort` on conflicts.
The body scrolls in short viewports while the header and footer remain reachable.

Each branch row also has a trash button with an explicit local/remote label and
a confirmation dialog. Deleting a local branch keeps its remote counterpart;
Git refuses unmerged branches unless **Force delete, even with unmerged commits**
is explicitly enabled. The active branch and branches checked out in another
worktree cannot be deleted, even with force. A stale selection is rejected.

Deleting a remote branch removes it from the server while preserving local
branches. The last-fetched commit is required, and a Git lease prevents deletion
if the server branch has changed since Fetch. Fetch and review before retrying
a stale-branch error; remote deletion has no force override. The local tracking
reference is removed only if it still points to the confirmed commit. Remote
HEAD aliases have no trash button. Deletion supports a single HTTPS GitHub push
URL per remote, validated before sending only the selected branch deletion;
custom mirror/refspec configuration, tags and submodules are not pushed.

**Clean up merged branches…** opens a read-only preview. Choose an existing
local or remote `main`/`master`, include local branches and optionally branches
on that same remote, review the candidate list and deselect anything to keep.
Remote cleanup requires a remote base: unpublished merges into a local main
are insufficient. Remote references reflect the last Fetch; the server checks
that the published main/master still matches before starting deletion.

Eligibility uses Git ancestry (`for-each-ref --merged`) with matching exact
commit IDs. Merges and fast-forwards qualify; squash/cherry-pick equivalents
are conservatively omitted. Main, master, symbolic remote HEAD and branches
checked out in any worktree (including their same-name remote counterparts)
are preserved. Previews expire after 15 minutes, are single-use, cover at most
200 eligible references per batch and are bound to the repository, base and
selected tips. Changed refs or worktree protection invalidate the preview before
any deletion. Local deletion retains Git's ordinary `-d` check, so a branch
merged into the chosen base can still be kept if the current branch/upstream
does not contain it; update/check out main/master and preview again. There is
no bulk force override. Remote deletions retain the per-branch lease.

Cleanup reports deleted, failed and skipped branches individually. Successful
deletions remain if a later operation fails. A remote error stops subsequent
remote deletions, and a changed base or the batch time limit stops the remaining
work. Refresh the preview before another batch; no automatic retries or rollback
are performed. The repository mutex serializes application mutations, while
external Git processes remain outside it as described in the security review.

The Git workspace provides History and Changes views. Selecting a commit or file
opens its detail at the full available width; Back returns to the previous view.
The mobile history hides the Type, Author, Date and Hash columns; commit details
retain that information. Staged and unstaged lists stack vertically, with visible
actions for touch input. Virtual history rows retain their existing graph spacing.

In Files, the explorer occupies the workspace while open and closes after a file
is selected. The sidebar open/close button toggles it. With no selected file,
the explorer always stays visible on mobile, including after closing the last tab. Drafts, save behavior and external change
checks use the existing editor store.

Dialogs fit the viewport, settings tabs scroll horizontally, and the application
uses dynamic viewport height and bottom safe-area padding. Git operations,
authentication, AI behavior and server paths are unchanged.

The mobile bottom status bar centers the branch name, truncates long names and
omits the desktop counters and SikaGit label to keep text away from rounded
corners. Activity remains visible as a compact spinner with an accessible label
and tooltip. Horizontal safe-area padding and the existing bottom safe-area
padding remain in place.

## Verification

Use mocked API responses and disposable data for browser verification. Check
320px and 390px phone widths, the 768px desktop breakpoint and a 1280px desktop:

- Open/close the repository drawer, including selecting the current repository.
- Switch History/Changes, open a commit and a file diff, then return.
- Open Files, select a file, toggle the explorer and retain the draft.
- Open repository/application settings and check all tabs remain reachable.
- Check document overflow, visible staging controls and browser runtime errors.

Do not use real repositories for write tests or invoke billable AI requests.

With a freshly started Vite on loopback port 5184, run
`node tests/repository-ui.browser.cjs` using Playwright/Chromium. Set
`SIKAGIT_BROWSER_CLIENT` to use an existing browser client and
`SIKAGIT_TEST_ORIGIN` to override the URL. This fixture mocks all responses,
including delayed/out-of-order replies, and checks cache misses, A → B → A,
status/branches/tags/history isolation, commit file selection, pending staging,
both switches, mobile header and confirmed bookmark removal at 320/390/1280px.

`node tests/merge-to.browser.cjs` retains its original filename and now exercises the unified dialog. It uses the same browser settings and mocks all
Git/API operations. It checks both merge directions, destination filtering,
confirmation and busy controls, optional source deletion, conflicts/abort,
errors, mobile overflow and the desktop Explorer divider at those widths.
The production-image suite additionally exercises the legacy Merge To endpoint against disposable
Git repositories, including dirty/stale requests and non-conflict failures.

`node tests/branch-delete.browser.cjs` uses the same browser settings and mocked
APIs to cover both deletion types, cancellation, explicit local force, active
branch/HEAD protections, stale remote errors, busy state, refresh and long-name
overflow at 320/390/1280px. Backend tests use disposable repositories and a
test-only Git transport adapter for one fixed fake GitHub URL to a local bare
repository. This exercises actual leased deletion without networking; the adapter
is never loaded or copied into production, and real repositories are not mounted.

`node tests/branch-cleanup.browser.cjs` verifies base/scope selection, deselection,
confirmation/cancellation, stale previews, busy state and partial results with
mocked APIs at 320/390/1280px. Isolated Git cases cover ancestry versus squash and
cherry-picks, worktrees, stale and forged plans, expiry/bounds, published-base
checks, leases and partial failure without real networking.

## File editor space and scrolling

File tabs and the current file's actions share a single 42 px row on mobile
(36 px on desktop). Save stays visible; text size, word wrap, search and the
remaining commands live in the grouped **Editor actions** menu. Desktop also
has a search button. Filenames have full-path tooltips, avoiding a second row
that repeats the active name.

When a mobile file opens, the repository actions and workspace tabs scroll
above the editor, leaving the repository header and file toolbar visible.
Scroll back toward the top to use those controls. The code area keeps its own
vertical/horizontal scrolling. **Expand editor** gives the file the full
viewport and has a visible exit control; Esc also exits after any open search
panel or menu is closed. Neither expansion nor a preference change remounts
CodeMirror or discards its undo history.

The mobile shell observes `visualViewport` resize events, including when a
software keyboard changes only the visible height. The expanded editor uses
the same height. Search fields use a 16 px mobile font and the native search
panel can scroll when its controls exceed the available height.

## Shared boolean controls

`client/src/components/ui/Switch.tsx` provides the same accessible control for
workspace preferences, merge options, cleanup scope, Settings, AI settings and
filters, and optional force deletion in confirmations. It supports descriptions,
short mobile labels, disabled states and native keyboard activation. Selection
lists retain checkboxes. In a confirmation, Enter on the switch only toggles
that option; activating Cancel with Enter cancels rather than confirming.

Validation on 2026-11-11: all 71 production-image security cases pass, including
explicit FF overriding `merge.ff=false`, no-FF creating a two-parent merge with
`merge.ff=only`, divergent merges with FF enabled, and rejecting invalid option
types without changing branches. Merge, branch deletion and cleanup browser
checks pass at 320, 390 and 1280 px with API/Git mutations mocked. The merge
checks also cover keyboard switches, compact footer geometry and a 350 px
viewport. Backend TypeScript and Vite compile; strict frontend TypeScript keeps
the same 35 baseline diagnostics.

## Optional Git command review

**Show Git commands** is a collapsed-by-default disclosure in the unified Merge dialog,
local/remote branch deletion and merged-branch cleanup. The shared
`GitCommandPreview` uses native details/summary so reviewing operations adds
space only when requested. Long commands wrap and scroll inside the dialog.
Opening the disclosure, using Enter on its summary, retrying a preview, or
changing an option never confirms the merge or deletion.

Merge previews update immediately with the selected branch, `--ff`/`--no-ff`,
and optional source deletion. A different destination shows the preceding
`git switch --no-guess`; source deletion is labelled as conditional on a
successful merge. After conflicts, the preview changes to `git merge --abort`,
matching the available action. Local deletion switches between `-d` and `-D`
with the force option.

Remote previews load only when expanded. The authenticated, Origin-protected
`POST /git/branch/delete-remote/preview` resolves the validated push URL, full
last-fetched commit and target ref from local Git data, showing the push lease
and conditional tracking-ref update. `POST /git/branch/cleanup/commands` uses
the existing repository-bound, expiring cleanup plan and selected refs. It
keeps the selection order, includes only selected branches and does not consume
the plan. These endpoints do not contact remotes or change files, HEAD, index
or refs. Unsafe URLs (including credentials), aliases and invalid selections
are refused. Failed loads offer a read-only retry.

The main operation argument arrays come from `shared/types/gitCommands.ts`,
which is also used by server execution. The UI displays safely quoted text
and labels conditional steps. Internal validation/probe commands and the
Git wrapper's global safety options are omitted, as stated in the disclosure.
The displayed text is never executed or submitted as a shell command. Execution
still revalidates current state; opening a preview does not reserve Git state
or guarantee a later operation will succeed.

Validation on 2026-11-11: all 75 production-image security cases pass. New cases
verify exact push argument parity, full leases with slash-named remotes, remote
previews while the disposable server is unavailable, unchanged local/server
refs and index, invalid targets without credential disclosure, authentication
and Origin protection, and selected cleanup commands without consuming the
plan. The browser merge/deletion/cleanup checks pass at 320, 390 and 1280 px,
including keyboard review, dynamic options, conditional deletion, conflict
abort, preview retry and zero mutation before explicit confirmation. Backend
TypeScript and Vite compile; strict frontend TypeScript keeps the identical
35 baseline diagnostics.

Validation of unified merging on 2026-11-11: all 82 production-image security
cases pass, including arbitrary local pairs, a current destination, same-name
tags, FF/no-FF, stale active/source/destination, partial staging, conflicting and
unrelated histories, worktree protection, abort and competing requests. The
test container now uses Docker `--init` to reap short-lived Git helper children
throughout the longer suite; its 160-PID limit and other runtime restrictions
remain in force. Backend TypeScript and Vite compile; strict frontend TypeScript
retains the same 35 baseline diagnostics. Browser fixtures pass at 320, 390 and
1280 px, with real mouse/touch pointer gestures, cancelled drags, keyboard
swapping, previews, source-deletion reset, guarded payloads and short viewports.
