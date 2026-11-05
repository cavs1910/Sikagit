# Mobile layout

Below 768 CSS pixels, SikaGit uses a repository drawer instead of the desktop
sidebar. Selecting a repository, pressing Escape or tapping the backdrop closes
it. Desktop sidebar visibility and saved panel sizes remain independent.

The mobile header uses the space beside the drawer button for the repository
name, branch selector and repository Settings button. Long names truncate.
**Remove repository** is inside Settings and requires confirmation; it removes
only the bookmark, preserving files on disk. Desktop uses the same controls.
The workspace tab bar contains **Show reflog** for History & Changes and the
matching **Show Git-ignored files** switch for Files.

The branch picker keeps **Merge…** and **Merge To…** buttons in its footer while
the branch list scrolls independently. **Merge…** brings another local branch
into the current branch. **Merge To…** selects a different local destination
(preferring `main` or `master`), previews current → destination and switches there
before merging. It requires a clean working tree and checks that the source is
still active under the repository mutex. It stays on the destination on success,
conflict or merge failure; abort also leaves the destination checked out. The
source is kept unless **Delete source branch after merge** is explicitly checked
and the merge succeeds. Neither action pushes. Detached HEAD and repositories
without another local branch disable **Merge To…**.

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

`node tests/merge-to.browser.cjs` uses the same browser settings and mocks all
Git/API operations. It checks both merge directions, destination filtering,
confirmation and busy controls, optional source deletion, conflicts/abort,
errors, mobile overflow and the desktop Explorer divider at those widths.
The production-image suite additionally exercises Merge To against disposable
Git repositories, including dirty/stale requests and non-conflict failures.
