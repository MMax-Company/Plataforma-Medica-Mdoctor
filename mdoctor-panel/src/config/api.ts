const PRODUCTION_API_URL = 'https://web-production-5f178.up.railway.app';
const LOCAL_API_URL = 'http://localhost:3004';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === 'production' ? PRODUCTION_API_URL : LOCAL_API_URL);
