# Mobile layout

Below 768 CSS pixels, SikaGit uses a repository drawer instead of the desktop
sidebar. Selecting a repository, pressing Escape or tapping the backdrop closes
it. Desktop sidebar visibility and saved panel sizes remain independent.

The branch picker keeps a **Merge…** button in its footer while the branch list
scrolls independently. It opens the existing merge dialog for the current branch.

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

## Verification

Use mocked API responses and disposable data for browser verification. Check
320px and 390px phone widths, the 768px desktop breakpoint and a 1280px desktop:

- Open/close the repository drawer, including selecting the current repository.
- Switch History/Changes, open a commit and a file diff, then return.
- Open Files, select a file, toggle the explorer and retain the draft.
- Open repository/application settings and check all tabs remain reachable.
- Check document overflow, visible staging controls and browser runtime errors.

Do not use real repositories for write tests or invoke billable AI requests.
