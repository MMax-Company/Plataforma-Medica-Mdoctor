import { ApiError, apiClient } from './api';

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  role: 'doctor' | 'admin' | string;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

const TOKEN_KEY = 'mdoctor_auth_token';
const USER_KEY = 'mdoctor_auth_user';
const LEGACY_MOCK_SESSION_KEY = 'mdoctor_panel_mock_session';

export const AUTH_UNAUTHORIZED_EVENT = 'mdoctor:auth:unauthorized';
export const AUTH_SESSION_CLEARED_EVENT = 'mdoctor:auth:cleared';

function browserStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function decodeJwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function getAuthToken() {
  return browserStorage()?.getItem(TOKEN_KEY) || '';
}

export function getAuthUser(): AuthUser | null {
  const raw = browserStorage()?.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasValidSession() {
  const token = getAuthToken();
  if (!token) return false;
  const exp = decodeJwtExp(token);
  if (!exp) return true;
  return exp * 1000 > Date.now() + 5000;
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function saveSession(session: AuthSession) {
  const storage = browserStorage();
  if (!storage) return;
  storage.removeItem(LEGACY_MOCK_SESSION_KEY);
  storage.setItem(TOKEN_KEY, session.token);
  storage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function clearSession() {
  const storage = browserStorage();
  if (!storage) return;
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(USER_KEY);
  storage.removeItem(LEGACY_MOCK_SESSION_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_CLEARED_EVENT));
  }
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const data = await apiClient.post<{ success: boolean; token: string; user: AuthUser; error?: string }>(
    '/api/auth/login',
    { user: username.trim(), password },
  );

  if (!data.success || !data.token) {
    throw new Error(data.error || 'Falha no login');
  }

  const session = { token: data.token, user: data.user };
  saveSession(session);
  return session;
}

export async function refreshSession(): Promise<AuthSession> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const data = await apiClient.post<{ success: boolean; token: string; user: AuthUser; error?: string }>(
    '/api/auth/refresh',
    null,
    { headers: authHeaders() },
  );

  if (!data.success || !data.token) {
    clearSession();
    throw new Error(data.error || 'Não foi possível renovar a sessão');
  }

  const session = { token: data.token, user: data.user };
  saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const token = getAuthToken();
  if (token) {
    try {
      await apiClient.post('/api/auth/logout', null, { headers: authHeaders() });
    } catch {
      // limpa sessão local mesmo se o backend estiver indisponível
    }
  }
  clearSession();
}

export async function requireSession() {
  const token = getAuthToken();
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const exp = decodeJwtExp(token);
  if (exp && exp * 1000 <= Date.now()) {
    clearSession();
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const data = await apiClient.get<{ success: boolean; user: AuthUser; error?: string }>('/api/auth/me', {
    headers: authHeaders(),
  });

  if (!data.success) {
    clearSession();
    throw new Error(data.error || 'Sessão expirada. Faça login novamente.');
  }

  return data.user as AuthUser;
}

export async function validateSession(): Promise<AuthUser | null> {
  if (!hasValidSession()) {
    clearSession();
    return null;
  }
  try {
    return await requireSession();
  } catch {
    clearSession();
    return null;
  }
}

export function bindAuthStorageSync(onChange: () => void) {
  if (typeof window === 'undefined') return () => undefined;

  const handler = (event: StorageEvent) => {
    if (!event.key || event.key === TOKEN_KEY || event.key === USER_KEY || event.key === LEGACY_MOCK_SESSION_KEY) {
      onChange();
    }
  };

  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function scheduleSessionRefresh() {
  if (typeof window === 'undefined') return () => undefined;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const plan = () => {
    if (timer) clearTimeout(timer);
    const token = getAuthToken();
    const exp = token ? decodeJwtExp(token) : null;
    if (!exp) return;

    const refreshInMs = Math.max(10_000, exp * 1000 - Date.now() - 30 * 60 * 1000);
    timer = setTimeout(async () => {
      try {
        await refreshSession();
        plan();
      } catch {
        clearSession();
        window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
      }
    }, refreshInMs);
  };

  plan();
  return () => {
    if (timer) clearTimeout(timer);
  };
}

export function isAuthApiError(error: unknown) {
  return error instanceof ApiError;
}
