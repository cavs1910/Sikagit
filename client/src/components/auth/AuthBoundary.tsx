import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { refreshOpenRepo } from '../../lib/repoRefresh';

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { status, error, checkSession, hasAuthenticated } = useAuthStore();
  const previousStatus = useRef(status);

  useEffect(() => {
    void checkSession();
    const resume = () => { if (document.visibilityState === 'visible') void checkSession(); };
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [checkSession]);

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (previous === status) return;
    if (status !== 'authenticated') return;
    if (previous !== 'checking') void refreshOpenRepo('manual');
  }, [status]);

  const authenticated = status === 'authenticated';
  return (
    <>
      {/* Keep mounted drafts when a session expires; reauthentication must not
          discard unsaved edits. The locked workspace cannot receive input. */}
      {(hasAuthenticated || authenticated) && <div className={authenticated ? 'contents' : 'hidden'} inert={!authenticated}>{children}</div>}
      {!authenticated && <main className="fixed inset-0 z-[200] overflow-auto bg-bg-primary text-text-primary flex items-center justify-center p-5">
        <div className="w-full max-w-sm rounded-lg border border-border bg-bg-secondary p-6 shadow-xl">
          <GitBranch size={30} className="text-accent mb-4" />
          <h1 className="text-xl font-semibold mb-2">SikaGit</h1>
          {status === 'checking' ? <p role="status" className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" />Checking your session…</p>
            : status === 'unavailable' ? <>
              <p role="alert" className="text-sm text-text-secondary mb-4">{error}</p>
              <button type="button" className="px-4 py-2 rounded bg-accent text-bg-primary text-sm font-medium" onClick={() => { useAuthStore.setState({ status: 'checking', error: null }); void checkSession(); }}>Retry connection</button>
            </> : <LoginForm message={error} />}
        </div>
      </main>}
    </>
  );
}

function LoginForm({ message }: { message: string | null }) {
  const login = useAuthStore(s => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true); setLoginError(null);
    try { await login(username, password); }
    catch (err) { setLoginError((err as Error).message); setSubmitting(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-text-secondary">Sign in to your private workspace.</p>
      <label className="block text-sm">Username
        <input name="username" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} className="mt-1 block w-full rounded border border-border bg-bg-primary px-3 py-2 text-base outline-none focus:border-accent" />
      </label>
      <label className="block text-sm">Password
        <input name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 block w-full rounded border border-border bg-bg-primary px-3 py-2 text-base outline-none focus:border-accent" />
      </label>
      {(loginError || message) && <p role="alert" className="text-sm text-danger">{loginError || message}</p>}
      <button type="submit" disabled={submitting} className="w-full flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-bg-primary disabled:opacity-50">{submitting && <Loader2 size={16} className="animate-spin" />}{submitting ? 'Signing in…' : 'Sign in'}</button>
      <p className="text-xs text-text-muted">Stay signed in on this device for 365 days.</p>
    </form>
  );
}
