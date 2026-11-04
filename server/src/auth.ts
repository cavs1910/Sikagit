import fs from 'fs';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { EventEmitter } from 'events';
import session from 'express-session';
import express, { Request, Response, NextFunction } from 'express';
import { SQLiteSessionStore } from './services/sessionStore';

const credentials = JSON.parse(fs.readFileSync(process.env.AUTH_FILE || '/run/secrets/auth.json', 'utf8'));
if (typeof credentials.username !== 'string' || !credentials.username || typeof credentials.password !== 'string' || credentials.password.length < 16) throw new Error('Strong authentication credentials are required');
const expected = createHash('sha256').update(`${credentials.username}:${credentials.password}`).digest();
const secure = (process.env.PUBLIC_ORIGIN || '').startsWith('https:');
export const SESSION_SECONDS = 365 * 24 * 60 * 60;
const COOKIE_NAME = 'sikagit_session_v2';
const cookieOptions = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure };
export const sessionStore = new SQLiteSessionStore();
export const sessionEvents = new EventEmitter();
export const sessionMiddleware = session({
  name: COOKIE_NAME,
  secret: createHmac('sha256', expected).update('sikagit-session-v2').digest('hex'),
  genid: () => randomBytes(32).toString('hex'),
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  // HTTPS terminates at the private reverse proxy. Secure is fixed by the
  // configured public origin, never downgraded based on a client header.
  proxy: true,
  cookie: { ...cookieOptions, maxAge: SESSION_SECONDS * 1000 },
});

function matches(value: string): boolean {
  return timingSafeEqual(createHash('sha256').update(value).digest(), expected);
}

export function hasSession(req: Request): boolean {
  return req.session?.authenticated === true && Number(req.session.expiresAt) > Date.now();
}

export function hasBasic(req: Request): boolean {
  // Browsers may keep sending credentials cached by the old Basic dialog.
  // Their requests use the form/session flow so logout cannot be undone by it.
  if (req.headers['sec-fetch-site']) return false;
  const authorization = req.headers.authorization || '';
  return authorization.startsWith('Basic ') && matches(Buffer.from(authorization.slice(6), 'base64').toString());
}

function createSession(req: Request, next: NextFunction): void {
  req.session.regenerate(err => {
    if (err) { next(err); return; }
    req.session.authenticated = true;
    req.session.expiresAt = Date.now() + SESSION_SECONDS * 1000;
    req.session.save(next);
  });
}

export function accessGuard(req: Request, res: Response, next: NextFunction): void {
  if (hasSession(req)) { next(); return; }
  // Preserve explicit Basic access for existing CLI integrations, without a
  // browser challenge (which can strand an iOS Home Screen web app).
  if (hasBasic(req)) { next(); return; }
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ success: false, error: 'Sign in to continue' }));
}

export const authRouter = express.Router();
authRouter.use(express.json({ limit: '4kb' }));
// Parser errors may quote the request body. Handle them here without sending
// credentials to the general error logger or reflecting them to the browser.
authRouter.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    res.status(err.type === 'entity.too.large' ? 413 : 400).json({ success: false, error: 'Invalid authentication request' }); return;
  }
  next(err);
});
authRouter.get('/session', (req, res) => {
  // Deliberately ignore cached Basic credentials here: logout must remain
  // effective even if an older Safari session cached those credentials.
  const authenticated = hasSession(req);
  res.json({ success: true, data: { authenticated, expiresAt: authenticated ? req.session.expiresAt : null } });
});

const WINDOW_MS = 15 * 60 * 1000;
let failedLogins = 0, windowEnds = 0;
authRouter.use((req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    res.status(415).json({ success: false, error: 'JSON required' }); return;
  }
  next();
});
authRouter.post('/login', (req, res, next) => {
  if (Date.now() >= windowEnds) { failedLogins = 0; windowEnds = Date.now() + WINDOW_MS; }
  // Single-owner installation: one bounded limiter, including attempts arriving
  // through the same private reverse proxy. No untrusted forwarded IP headers.
  if (failedLogins >= 10) {
    res.setHeader('Retry-After', String(Math.ceil((windowEnds - Date.now()) / 1000)));
    res.status(429).json({ success: false, error: 'Too many sign-in attempts. Try again later.' }); return;
  }
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !matches(`${username}:${password}`)) {
    failedLogins++;
    if (failedLogins >= 10) windowEnds = Date.now() + WINDOW_MS;
    res.status(401).json({ success: false, error: 'Incorrect username or password' }); return;
  }
  failedLogins = 0;
  windowEnds = 0;
  const previous = req.sessionID;
  createSession(req, err => {
    if (err) { next(err); return; }
    sessionEvents.emit('revoked', previous);
    res.json({ success: true, data: { authenticated: true, expiresAt: req.session.expiresAt } });
  });
});
authRouter.post('/logout', (req, res, next) => {
  const id = req.sessionID;
  req.session.destroy(err => {
    if (err) { next(err); return; }
    sessionEvents.emit('revoked', id);
    res.clearCookie(COOKIE_NAME, cookieOptions);
    res.clearCookie('sikagit_session', cookieOptions);
    res.json({ success: true, data: { authenticated: false, expiresAt: null } });
  });
});
