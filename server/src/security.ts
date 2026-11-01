import fs from 'fs';
import path from 'path';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

const root = process.env.PROJECTS_ROOT || '/repos';
const allowedOrigin = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:3001';
const credentials = JSON.parse(fs.readFileSync(process.env.AUTH_FILE || '/run/secrets/auth.json', 'utf8'));
if (typeof credentials.username !== 'string' || !credentials.username || typeof credentials.password !== 'string' || credentials.password.length < 16) throw new Error('Strong authentication credentials are required');
const expected = createHash('sha256').update(`${credentials.username}:${credentials.password}`).digest();

export function accessGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && origin !== allowedOrigin) {
    res.statusCode = 403; res.end('Origin rejected'); return;
  }
  if (req.headers['sec-fetch-site'] === 'cross-site' && !(req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate')) {
    res.statusCode = 403; res.end('Cross-site access rejected'); return;
  }
  const authorization = req.headers.authorization || '';
  const value = authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString() : '';
  const actual = createHash('sha256').update(value).digest();
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('sikagit_session='))?.slice('sikagit_session='.length) || '';
  const [expires, signature] = cookie.split('.');
  const sign = (v: string) => createHmac('sha256', expected).update(v).digest('hex');
  const signed = signature && /^[0-9a-f]{64}$/.test(signature) && /^\d{13}$/.test(expires || '') && Number(expires) > Date.now() && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(expires), 'hex'));
  const basic = authorization.startsWith('Basic ') && timingSafeEqual(actual, expected);
  if (!basic && !signed) {
    res.setHeader('WWW-Authenticate', 'Basic realm="SikaGit", charset="UTF-8"');
    res.statusCode = 401; res.end('Authentication required'); return;
  }
  if (basic && !signed) {
    const expiry = String(Date.now() + 8 * 60 * 60 * 1000);
    res.setHeader('Set-Cookie', `sikagit_session=${expiry}.${sign(expiry)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${allowedOrigin.startsWith('https:') ? '; Secure' : ''}`);
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
}

export function confinedRepo(input: string): string {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw new Error('Invalid repository path');
  const actual = fs.realpathSync(input);
  const allowed = fs.realpathSync(root);
  if (actual !== allowed && !actual.startsWith(allowed + path.sep)) throw new Error('Repository outside allowed root');
  if (path.relative(allowed, actual).split(path.sep).includes('.git')) throw new Error('Git metadata is not a repository root');
  return actual;
}

export function confinedFile(repo: string, file: string): string {
  if (typeof file !== 'string' || !file || path.isAbsolute(file) || /[\0\r\n]/.test(file) || file.startsWith('-')) throw new Error('Invalid file path');
  const base = confinedRepo(repo);
  const full = path.resolve(base, file);
  if (!full.startsWith(base + path.sep) || path.relative(base, full).split(path.sep).includes('.git')) throw new Error('File outside repository or Git metadata');
  let probe = full;
  while (true) {
    try { fs.lstatSync(probe); break; } catch (err: any) { if (err.code !== 'ENOENT') throw err; }
    const parent = path.dirname(probe);
    if (parent === probe) throw new Error('Invalid file path');
    probe = parent;
  }
  const actual = fs.realpathSync(probe);
  if (actual !== base && !actual.startsWith(base + path.sep)) throw new Error('Symlink escapes repository');
  if (path.relative(base, actual).split(path.sep).includes('.git')) throw new Error('Symlink resolves to Git metadata');
  return full;
}

export function safeFiles(repo: string, files: string[]): void {
  if (!Array.isArray(files) || files.length > 10000) throw new Error('Invalid file list');
  for (const file of files) confinedFile(repo, file);
}

export function safeRevision(value: string): void {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{4,64}(?:[~^][0-9]*)?$/.test(value)) throw new Error('Invalid commit identifier');
}

export function safeRef(value: string): void {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/.test(value) || value.includes('..') || value.includes('//')) throw new Error('Invalid branch name');
}

export function safeRemote(value: string): void {
  if (typeof value !== 'string' || !/^https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(value)) throw new Error('Only HTTPS GitHub remotes are enabled');
}
