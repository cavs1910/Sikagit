# Reviewed private-server deployment

This fork preserves local hardening of upstream commit `35779966b00fd2b22fda0e91659e31c5ad731725`.
Use `Dockerfile.reviewed` and `deploy/compose.reviewed.yaml`; the default Dockerfile and root Compose files now use the same hardened configuration; the originals remain available in Git history and the upstream repository.

Set `SIKAGIT_STATE_DIR` to a directory outside this checkout, `HOST_REPO_PATH` to one trusted repository, `GH_HOSTS_FILE` to the existing GitHub CLI hosts file, and `PUBLIC_ORIGIN` to the exact HTTPS origin served by the private reverse proxy. The configured UID must own the repository and data files.

Create `$SIKAGIT_STATE_DIR/data`, and a private `$SIKAGIT_STATE_DIR/secrets/auth.json` containing `username` and a strong random `password`. Restrict permissions to the service user. Create `$SIKAGIT_STATE_DIR/gitconfig` with a GitHub-only `credential.https://github.com.helper` set to `/usr/local/bin/sikagit-credential`. Configure author name/email in repository settings. Never commit credentials, state databases, or local deployment settings.

Build and start with `docker compose -f deploy/compose.reviewed.yaml up --build -d`. The only published port is loopback `127.0.0.1:8448`; configure an authenticated, private HTTPS proxy such as Tailscale Serve. Do not expose the backend publicly.

The application uses HTTP Basic authentication and signed HttpOnly sessions, rejects foreign browser origins, confines files to the configured repository root, disables external AI routes, and blocks arbitrary Git configuration writes. The container has a read-only root filesystem, no Linux capabilities, and no Docker socket or host home mount. Git hooks, signing programs, external diff/merge drivers, local credential commands, config includes, and local/ext transports are blocked by the Git policy. The small credential helper only returns the active GitHub token for HTTPS github.com; gh and npm are absent from the runtime image.

`tests/security.test.cjs` contains the self-contained security regression suite. Run `scripts/test-security.sh` from a Docker-capable host: it builds the reviewed image and runs tests without network access, host credentials, or real repositories. `security-check.py` preserves the older integration checks and requires its separate fixture; do not run it against a live repository. See `docs/SECURITY_REVIEW.md` for the deeper review and remaining limits. The original frontend has pre-existing TypeScript errors; the reviewed image compiles the backend with TypeScript and builds the frontend with Vite. Browser smoke tests were run separately.

This is not a guarantee that the application or its dependencies are free of vulnerabilities. Keep deployment credentials outside source control and review future upstream/dependency updates before upgrading.

The upstream source-available license remains in force. This fork does not relicense the upstream project.
