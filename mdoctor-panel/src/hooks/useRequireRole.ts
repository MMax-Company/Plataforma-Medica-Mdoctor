'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from './useRequireAuth';
import type { AuthUser } from '@/services/auth.service';

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated' }
  | { status: 'forbidden' };

export function useRequireRole(allowedRoles: string[]): AuthState {
  const auth = useRequireAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!allowedRoles.includes(auth.user.role)) {
      const role = auth.user.role;
      if (role === 'admin' || role === 'doctor') {
        router.replace('/fila');
      } else if (role === 'administrativo') {
        router.replace('/admin/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [auth, allowedRoles, router]);

  if (auth.status === 'authenticated' && !allowedRoles.includes(auth.user.role)) {
    return { status: 'forbidden' };
  }

  return auth as AuthState;
}

export function defaultRedirectForRole(role: string): string {
  if (role === 'administrativo') return '/admin/dashboard';
  return '/fila';
}
