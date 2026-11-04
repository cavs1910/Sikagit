import { create } from 'zustand';

type AuthStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';
interface AuthState {
  status: AuthStatus;
  hasAuthenticated: boolean;
  error: string | null;
  checkSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  requireLogin: () => void;
}

async function authRequest(route: string, credentials?: { username: string; password: string } | Record<string, never>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api/v1/auth/${route}`, {
      method: credentials ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: credentials ? JSON.stringify(credentials) : undefined,
      signal: controller.signal,
    });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || 'Unable to sign in');
    return json.data as { authenticated: boolean; expiresAt: number | null };
  } catch (error) {
    if (error instanceof TypeError || (error as Error).name === 'AbortError') {
      throw new Error('Cannot reach SikaGit. Check your connection and Tailscale, then try again.');
    }
    throw error;
  } finally { clearTimeout(timer); }
}

let pendingCheck: Promise<void> | null = null;
let generation = 0;
export const authGeneration = () => generation;
// Credentials and session identifiers are never persisted in browser storage.
export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'checking',
  hasAuthenticated: false,
  error: null,
  checkSession: () => {
    if (pendingCheck) return pendingCheck;
    const seq = generation;
    pendingCheck = authRequest('session').then(data => {
      if (seq !== generation) return;
      set({ status: data.authenticated ? 'authenticated' : 'anonymous', hasAuthenticated: data.authenticated || get().hasAuthenticated, error: null });
    }).catch((error: Error) => {
      if (seq !== generation) return;
      set({ status: get().status === 'authenticated' ? 'authenticated' : 'unavailable', error: error.message });
    }).finally(() => { pendingCheck = null; });
    return pendingCheck;
  },
  login: async (username, password) => {
    ++generation;
    await authRequest('login', { username, password });
    ++generation;
    set({ status: 'authenticated', hasAuthenticated: true, error: null });
  },
  logout: async () => {
    ++generation;
    await authRequest('logout', {});
    ++generation;
    set({ status: 'anonymous', error: null });
  },
  requireLogin: () => {
    ++generation;
    set({ status: 'anonymous', error: 'Your session ended. Sign in to continue.' });
  },
}));
