import session from 'express-session';
import { createHash } from 'crypto';
import { db } from './db';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    expiresAt?: number;
  }
}

// Same database and backup path as the rest of the installation. Only hashes
// of opaque session identifiers are stored; a DB read does not reveal cookies.
db.exec(`CREATE TABLE IF NOT EXISTS auth_sessions (
  id_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  data TEXT NOT NULL
)`);
const read = db.prepare('SELECT data FROM auth_sessions WHERE id_hash = ? AND expires_at > ?');
const write = db.prepare('INSERT OR REPLACE INTO auth_sessions (id_hash, expires_at, data) VALUES (?, ?, ?)');
const remove = db.prepare('DELETE FROM auth_sessions WHERE id_hash = ?');
const prune = db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?');
const hash = (id: string) => createHash('sha256').update(id).digest('hex');
prune.run(Date.now());

export class SQLiteSessionStore extends session.Store {
  get(id: string, callback: (err: unknown, value?: session.SessionData | null) => void): void {
    let value: session.SessionData | null;
    try {
      const row = read.get(hash(id), Date.now()) as { data: string } | undefined;
      value = row ? JSON.parse(row.data) : null;
    } catch (err) { callback(err); return; }
    callback(null, value);
  }

  set(id: string, value: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      if (!value.authenticated || !Number.isSafeInteger(value.expiresAt)) throw new Error('Invalid session');
      prune.run(Date.now());
      write.run(hash(id), value.expiresAt, JSON.stringify(value));
    } catch (err) { callback?.(err); return; }
    callback?.();
  }

  destroy(id: string, callback?: (err?: unknown) => void): void {
    try { remove.run(hash(id)); } catch (err) { callback?.(err); return; }
    callback?.();
  }

  // Absolute expiry: activity must not extend the requested one-year lifetime.
  touch(_id: string, _value: session.SessionData, callback?: () => void): void { callback?.(); }
}
