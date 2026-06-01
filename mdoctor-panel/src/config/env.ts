/** Mock/fallback desligado por padrão em staging/produção. */
export function isMockFallbackEnabled(): boolean {
  if (isMemedRealEnabled()) return false;
  const flag = process.env.NEXT_PUBLIC_ENABLE_MOCK_FALLBACK?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

/** Alinhado ao backend MEMED_REAL_ENABLED — homologação MdHub real. */
export function isMemedRealEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_MEMED_REAL_ENABLED?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}
