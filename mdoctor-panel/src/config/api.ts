/** Backend staging — destino do proxy /api/* (next.config.mjs). */
export const STAGING_BACKEND_URL = 'https://mdoctor-backend-staging-staging.up.railway.app';

/** Base URL para fetch: browser = same-origin (proxy /api); SSR = backend absoluto. */
export function getApiBase() {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  const fromEnv = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (fromEnv || STAGING_BACKEND_URL).replace(/\/$/, '');
}

/** @deprecated use getApiBase() em runtime */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL?.trim() || STAGING_BACKEND_URL).replace(/\/$/, '');
