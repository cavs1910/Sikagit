# Persistent private-server login

SikaGit uses `express-session` with an SQLite store in the existing
`DATA_DIR/sikagit.db`. The login form accepts the same username and password
already provisioned in `AUTH_FILE`; there is no registration or external
identity provider. Better Auth's Express integration requires ESM, while this
backend uses CommonJS. This integration keeps the existing runtime and private
single-owner model.

## Browser and Home Screen flow

The application shell, manifest and bundled static assets are public on the
private service. Repository data, editor endpoints, AI endpoints, health and
Socket.IO remain authenticated. Opening the shell no longer invokes an HTTP
Basic dialog. The app checks `/api/v1/auth/session` before mounting the workspace
and shows a normal login form when needed. The initial HTML also contains a
visible loading/connection message if JavaScript cannot load.

A successful `POST /api/v1/auth/login` creates a fresh random 256-bit session ID
and sets a signed `sikagit_session_v2` cookie with `HttpOnly`, `SameSite=Strict`,
`Path=/`, and `Secure` when `PUBLIC_ORIGIN` is HTTPS. Its expiration is **365 days
from login**, enforced by the server as an absolute deadline. Reads and activity
do not extend it. No password or session token is stored in localStorage or
sessionStorage. SQLite stores a SHA-256 hash of the ID, the deadline and session
metadata, so a database read does not expose usable cookies.

The app rechecks its session after pageshow, focus and visibility changes.
Expired sessions and API 401s show login; the mounted workspace is hidden and
inert while locked, preserving in-memory file drafts for reauthentication.
Session checks and form requests have a 10-second timeout with visible errors
and retry. Network failure alone does not sign out an already open workspace.

Use **App Settings → General → Session → Sign out** to revoke the current
session, expire the cookie and disconnect its existing Socket.IO connections.
Other independently created sessions stay active. Incoming socket messages
recheck the database, including expiry/revocation. Session checks ignore cached
Basic credentials so Safari cannot silently undo logout. Explicit Basic requests
to protected APIs still work for existing scripts, without creating database
sessions on every health probe; the server does not send `WWW-Authenticate`
challenges. Requests carrying the browser's `Sec-Fetch-Site` header cannot use
cached Basic credentials to bypass logout. Browser sessions are created only by
the login endpoint.

iOS Home Screen apps have separate storage from Safari after installation.
WebKit documents cookie copying when creating the Home Screen app on iOS 17.2+;
subsequent cookies are not continuously shared. An existing installed app may
need one login of its own. The server cannot preserve a cookie if the user or OS
removes website data. The manifest declares standalone display; no service worker
or offline copy of private repository data is added.

## Security and operations

- Existing Origin, cross-site request and CSP checks also cover the public shell
  and authentication routes. Login/logout require JSON; foreign origins are
  rejected before any session operation.
- Ten failed form logins trigger a 15-minute installation-wide cooldown. This
  bounded limiter deliberately ignores untrusted forwarded IP headers, resets
  on server restart, and does not block existing sessions or CLI Basic access.
- Session IDs regenerate on login. Replaced IDs and logged-out IDs are revoked.
  Legacy eight-hour `sikagit_session` cookies are no longer accepted; log in once
  after upgrading. Logout also clears the legacy cookie.
- The signing secret is derived with domain separation from the existing strong
  credentials. Changing `AUTH_FILE` credentials and restarting invalidates all
  browser sessions. Never put credentials in source, browser code or logs.
- Sessions survive container recreation because their additive `auth_sessions`
  table uses the existing database volume. SQLite API backups include sessions.
  Treat backups as private. Expired rows are pruned at startup and session save.
- TLS terminates at the private reverse proxy. The session middleware recognizes
  its HTTPS forwarding header to issue Secure cookies; the Secure policy itself
  is fixed by `PUBLIC_ORIGIN`. Keep the backend bound to host loopback, behind
  Tailscale Serve, as in the existing Compose installation.
- This remains a trusted-owner service, with the existing plaintext mounted
  credential file, no MFA and full access to mounted repositories after login.

## Verification

`sh scripts/test-security.sh` exercises anonymous shell/asset loading, protected
APIs and sockets, one-year expiry, cookie forgery, hashed storage, no sliding
expiry, login/logout Origin/JSON checks, device-specific revocation, live socket
disconnect, restart persistence, credential rotation, Secure cookies and login
cooldown. It uses the production image, networking disabled and disposable data.

For end-to-end browser verification, start the disposable fixture server:

```sh
docker run --rm --name sikagit-auth-browser-test --read-only --user 1001:1001 \
  --cap-drop ALL --security-opt no-new-privileges --memory 1g --pids-limit 160 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m,uid=1001,gid=1001 \
  -p 127.0.0.1:18890:3001 -v "$PWD/tests:/tests:ro" --entrypoint node \
  local/sikagit:security-test /tests/auth-browser-server.cjs
```

Then run `node tests/auth.browser.cjs` with Playwright/Chromium available.
`SIKAGIT_BROWSER_CLIENT` accepts an existing Playwright module/browser client;
`SIKAGIT_TEST_ORIGIN` overrides the loopback URL. The fixture tests mobile and
desktop, incorrect/correct login, cookies across reload and a new browser
context, draft retention after revocation, plain-text 401 handling, logout and
connection retry. It uses a hardcoded **test-only** credential and a generated
repository inside container tmpfs; never mount real state or credentials.
Chromium mobile emulation does not replace a physical iOS Home Screen test.

The 2026-11-04 verification passed 50 isolated tests and the mobile/desktop
browser flows above. Backend TypeScript and Vite compile; the frontend strict
check retains its 35 pre-existing diagnostics. Production npm audit reports zero
advisories. Semgrep reports the same three reviewed baseline findings and no
parse errors. Trivy reports zero vulnerabilities and zero secrets after updating
the runtime's libexpat to at least 2.10.0-r0 in both equivalent Dockerfiles.

Sources: [Express session middleware](https://expressjs.com/en/resources/middleware/session/),
[Better Auth Express integration](https://better-auth.com/docs/integrations/express),
[WebKit iOS 17.2 cookies](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/),
[OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
