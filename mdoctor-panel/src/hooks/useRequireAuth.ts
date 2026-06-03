'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUTH_UNAUTHORIZED_EVENT,
  bindAuthStorageSync,
  clearSession,
  requireSession,
  type AuthUser,
} from '@/services/auth.service';

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated' };

export function useRequireAuth(): AuthState {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      requireSession()
        .then((user) => {
          if (!cancelled) setState({ status: 'authenticated', user });
        })
        .catch(() => {
          clearSession();
          if (!cancelled) {
            setState({ status: 'unauthenticated' });
            router.replace('/login');
          }
        });
    };

    load();

    const onUnauthorized = () => {
      clearSession();
      if (!cancelled) {
        setState({ status: 'unauthenticated' });
        router.replace('/login');
      }
    };

    const unbindStorage = bindAuthStorageSync(() => {
      if (!cancelled) load();
    });

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);

    return () => {
      cancelled = true;
      unbindStorage();
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [router]);

  return state;
}
