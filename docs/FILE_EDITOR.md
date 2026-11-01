# Repository file editor

Open a repository and select **Files**, next to **History & Changes**. The explorer displays folders on demand, including unchanged and untracked files. Use **Show Git-ignored files** to include ignored files; `.git` remains hidden. The filename filter applies to files in expanded folders. Refresh the tree after external file creation, deletion or renaming.

Click a text file to open it. Diff file headers in **History & Changes** also include an **Open in editor** button that switches to Files and selects the working-tree file. From a historical commit, this opens the current file on disk. Existing drafts are preserved; deleted or unsupported files show the editor’s normal read error. Multiple files can remain open in tabs. **Save** and **Cmd/Ctrl+S** write to the original server file; saving does not stage or commit anything. The Git status and sidebar indicator refresh after a successful save. Switch back to **History & Changes** to review, stage and commit.

The editor uses CodeMirror 6, loaded only when needed, with undo/redo, line numbers, indentation, bracket matching, search/replace and syntax support for JavaScript/TypeScript/JSX, JSON, Markdown, Python, HTML and CSS. Other UTF-8 files use plain text editing. No additional process, port, account or external editor service is needed.

Drafts remain in browser memory across file, tab and repository switches. Closing a dirty file asks before discarding. Refreshing or leaving the app triggers the browser's unsaved-changes warning. Drafts are not stored in localStorage or sent to AI. Browsers may terminate tabs without delivering an unload event, especially on mobile devices; save before leaving.

## Concurrent changes

The selected file is checked every six seconds while the Files workspace is visible and the document is not hidden, and on window focus. The server also checks the original revision on every save. An external modification shows a warning and keeps the draft. Use **Copy draft** before **Reload** to preserve text for manual merging. Reloading a dirty document requires confirmation. Overwriting a conflicting revision is not offered.

Saving uses a temporary sibling file and atomic rename, preserving ordinary permission bits. Editor operations share the repository lock with Git operations in this application. External processes do not share that lock; the revision is checked again just before rename, but this is not a filesystem transaction against arbitrary external processes or a hostile filesystem actor.

## Boundaries

Editing is restricted to existing UTF-8 regular files within the selected repository, up to **1 MiB**. LF/CRLF and UTF-8 BOM are preserved. Binary files, invalid UTF-8, mixed/legacy line endings, symlinks and multiple hard links are rejected. Symlink directories cannot be browsed. Git metadata and paths outside the repository are unavailable. Existing read-only file permissions are respected. File creation, renaming, deletion, image editing, language servers and terminals are outside this editor's scope.

Directory listings are limited to 2,000 entries per folder and the browser allows 30 open files across repositories. Git-ignored files are hidden by default to avoid loading dependency trees. The private SikaGit runtime remains outside the projects mount.

## Verification

The production-image security suite covers tree navigation and Git ignores; exact UTF-8/BOM/CRLF saving; file modes and unchanged index; stale and concurrent saves; metadata and path confinement; symlinks, hard links, binary/invalid text and mixed newlines; size limits, read-only files, FIFO rejection and missing revisions. A browser integration check exercises editing, the save shortcut, search, drafts, reload confirmation and conflicts against disposable fixtures.

Validation on 2026-11-01: 31 production-image regression cases and 10 browser checks passed. The backend TypeScript and production Vite builds pass. Strict frontend TypeScript checking reports the same 35 diagnostics as the previous version, with none added by the editor. Production npm audit and the Trivy image scan report zero known vulnerabilities; the image secret scan reports zero findings. Semgrep scanned the new files with zero parse errors and retained only the three findings already reviewed in [the baseline report](SECURITY_REVIEW.md). The editor core is a separate approximately 132 KiB gzip chunk; language modules are also loaded on demand.
