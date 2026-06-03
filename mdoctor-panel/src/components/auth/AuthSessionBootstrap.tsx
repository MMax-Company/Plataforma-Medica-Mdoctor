'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  AUTH_SESSION_CLEARED_EVENT,
  AUTH_UNAUTHORIZED_EVENT,
  bindAuthStorageSync,
  clearSession,
  requireSession,
  scheduleSessionRefresh,
} from '@/services/auth.service';

export function AuthSessionBootstrap() {
  const router = useRouter();

  useEffect(() => {
    const stopRefresh = scheduleSessionRefresh();

    const onUnauthorized = () => {
      clearSession();
      if (!window.location.pathname.startsWith('/login')) {
        router.replace('/login');
      }
    };

    const onStorageSync = () => {
      if (!localStorage.getItem('mdoctor_auth_token')) {
        if (!window.location.pathname.startsWith('/login')) {
          router.replace('/login');
        }
        return;
      }
      requireSession().catch(() => {
        clearSession();
        if (!window.location.pathname.startsWith('/login')) {
          router.replace('/login');
        }
      });
    };

    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, onStorageSync);
    const unbindStorage = bindAuthStorageSync(onStorageSync);

    return () => {
      stopRefresh();
      unbindStorage();
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized);
      window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, onStorageSync);
    };
  }, [router]);

  return null;
}
