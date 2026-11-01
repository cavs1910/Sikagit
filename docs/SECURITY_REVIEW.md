# Private-server security review — 2026-11-01

This is a focused manual review plus automated scanning and regression tests of this fork. It is not a certification, penetration test of GitHub/Tailscale, or proof that all dependencies are free of malicious code. The intended deployment is one trusted owner operating known repositories behind private HTTPS, not an Internet-facing or multi-tenant service.

## Scope and evidence

The starting upstream revision was `35779966b00fd2b22fda0e91659e31c5ad731725`. The first preserved hardening commit is `c360b50`. This second pass covered API/WebSocket authentication, filesystem boundaries, Git configuration and command execution, destructive workflows, history parsing, dependencies, the runtime image, and Git history secrets.

- **Regression tests:** 19 named Node test cases passed in the actual production image, with networking disabled, a read-only root filesystem and no real repositories or credentials mounted. Reproduce with `scripts/test-security.sh`.
- **Semgrep:** `p/security-audit` and `p/nodejs`, metrics disabled; 109 targets, zero parse errors. Three remaining findings were manually reviewed, as described below. No findings were hidden with suppression comments.
- **Gitleaks:** full available Git history (`--all --full-history`), with secrets redacted in reports; no leaks detected. Working-tree changes were also inspected before publication.
- **Trivy:** exported image scanned without mounting the Docker socket. The first Debian image had 333 OS-package and 23 bundled-tooling findings. The Alpine runtime, without npm/yarn/gh or compilers, had zero reported vulnerabilities and zero detected secrets across its detected OS and Node packages. Replacing/removing packages is not the same as individually proving every old advisory unreachable or fixed.
- **Application dependencies:** regenerated integrity-locked npm dependencies; zero production advisories reported by npm audit during the first pass. No dependency versions changed in this second pass.
- **Live validation:** authenticated GitHub identity checked without logging its token; both registered repositories support status/history/fetch over private HTTPS. No test commits or pushes were made to the user's other working repository.

The operator keeps the raw JSON/TAP reports outside the source tree; they may contain deployment paths and should be inspected before redistribution. Scanner databases and rules reflect their execution time, not an ongoing guarantee.

## Confirmed issues corrected

1. **Shell execution:** upstream interpolated revisions and paths into shell strings. The first pass replaced shell execution with fixed binaries and separated arguments and validated revisions/refs/files.
2. **Path boundaries:** working-file reads/deletes were not confined. Validation now checks lexical and real paths, dangling links, cross-repository links, and links resolving into `.git` metadata. Metadata cannot be selected as a repository root. Paths with newline/NUL controls and option-like names are rejected.
3. **Deletion of tracked work:** `delete-untracked` did not verify Git state. It now obtains the current untracked set, validates the entire batch before deleting anything, and runs under the repository mutex.
4. **Repository-controlled programs:** hooks alone are insufficient. The Git policy rejects local/worktree config includes, credential commands, aliases, filters, external diff/merge drivers, editors, repository HTTP overrides and URL rewrites. It forces hooks/fsmonitor/signing off, disallows local/ext transports, and disables external/textconv diff execution. It does not relax simple-git's unsafe-operation guards.
5. **Unsafe historical checkout:** upstream could reset the current branch with `--hard`. Historical checkout now uses detached HEAD and preserves work according to Git's ordinary checkout checks.
6. **Partial staging/shelving:** save-for-later rejects a partially staged index it cannot faithfully preserve. If cleanup fails after creating a save commit, its branch is retained rather than deleted by rollback.
7. **History integrity:** newline-based record delimiters could be forged by commit-message contents. History records now use NUL-delimited fields; a message containing the former delimiter is a regression fixture.
8. **Resource and request controls:** nonregular/oversized working-file previews are rejected, history requests have bounded page sizes, and destructive JSON flags must be booleans rather than truthy strings. Recent Git locks cannot be deleted through the cleanup endpoint.
9. **Authentication/active content:** HTTP and Socket.IO require Basic authentication or a signed HttpOnly session, with strict browser-origin checks. File responses have a script-free sandbox CSP and nosniff; general pages restrict scripts/connections/images to the application origin. The original Gemini-only route was disabled in this reviewed baseline. The subsequent Vercel AI SDK integration is opt-in and documented in [AI configuration](AI_CONFIGURATION.md), with additional regression tests; baseline scan counts below do not describe the later image.
10. **Runtime/default deployment:** a pinned official Alpine Node image replaces Debian plus bundled package managers and gh. Defaults now point to the hardened non-root deployment instead of the original broad home/mnt mounts. The entrypoint no longer copies tokens to a plaintext Git credential store. A small get-only helper returns the active account token exclusively for HTTPS github.com. Build contexts exclude credentials, environment files, nested dependencies, databases and backups.

## Semgrep triage

- Two dynamic `urllib` findings are in the older `security-check.py` fixture client. Their base URL is a constant loopback HTTP endpoint, not request-controlled input; that client is not shipped in the runtime image. The self-contained Node suite supersedes its setup-dependent use.
- The direct response write in the file-preview endpoint intentionally returns a Buffer, with explicit MIME type, nosniff and a sandbox CSP whose default source policy denies all content. It is not interpolated into HTML. A regression test checks these headers on an active SVG. Removing those response protections would reopen this finding.

## Remaining trust boundaries and limits

- Anyone authorized to use this single-user service can change every mounted repository using its Git operations. This is not per-repository authorization or a safe service for arbitrary strangers.
- The application process must read a GitHub token. The restricted helper prevents accidental delivery to another host, but cannot hide that token from arbitrary code execution inside the same process/container. The existing token retains its original permissions; a separately provisioned fine-grained token would further reduce impact.
- The container is not an egress firewall. Browser CSP limits browser requests; it does not restrict arbitrary server-side code if a future exploit executes it.
- Real-path validation is not race-free against a hostile process changing the host filesystem concurrently. Hard links, worktree administrative paths and Git's own filesystem behavior are not a complete capability sandbox. Operate trusted local working trees; do not run malware or mutually hostile users alongside the service.
- The app's mutex cannot coordinate every external CLI/editor. In particular, old lock-file cleanup and shelving are not fully transactional against simultaneous external Git/filesystem changes. Recovery refs/reflogs and backups remain important; normal discard/reset/uncommit actions retain their destructive Git meaning when explicitly requested.
- Basic authentication has no separate MFA or account/rate-limit system. Private-network access controls, a long random password and secure HTTPS are required. Signing and hooks are deliberately disabled, so pre-commit/pre-push validation and signing do not run through this client.
- Strict branch/file/config policies can reject otherwise valid advanced Git workflows. LFS/custom filters, custom credentials, external merge/diff tools and arbitrary hosts are not supported in this deployment.
- The upstream frontend has pre-existing TypeScript errors. The backend typechecks, and Vite builds the frontend; browser smoke tests are separate from a complete frontend typecheck. Do not infer a fully green upstream test suite.
- Scanners use patterns/advisory databases, not a line-by-line audit of every transitive dependency, native library or Git implementation. Unknown vulnerabilities and supply-chain compromise remain possible. Updates must be rebuilt, rescanned and tested rather than pulled automatically.
