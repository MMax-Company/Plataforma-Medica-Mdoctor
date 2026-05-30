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

function browserStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
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
  return Boolean(getAuthToken());
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
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const data = await apiClient.post<{ success: boolean; token: string; user: AuthUser; error?: string }>(
    '/api/auth/login',
    {
      user: username,
      username,
      email: username,
      password,
    }
  );

  if (!data.success || !data.token) {
    throw new Error(data.error || 'Falha no login');
  }

  const session = { token: data.token, user: data.user };
  saveSession(session);
  return session;
}

export async function requireSession() {
  const token = getAuthToken();
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const data = await apiClient.get<{ success: boolean; user: AuthUser; error?: string }>('/api/auth/me', {
    headers: authHeaders(),
  });

  if (!data.success) {
    clearSession();
    throw new Error(data.error || 'Sessão expirada. Faça login novamente.');
  }

  return data.user as AuthUser;
}

export function isAuthApiError(error: unknown) {
  return error instanceof ApiError;
}
