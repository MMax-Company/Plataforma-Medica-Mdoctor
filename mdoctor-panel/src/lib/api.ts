import { API_BASE } from '@/config/api';

export async function apiRequest(endpoint: string, options?: RequestInit) {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('mdoctor_auth_token') : '';
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {})
    },
    ...options,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
