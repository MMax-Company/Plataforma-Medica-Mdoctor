const THEME_TIMEOUT_MS = 4000;

/**
 * Ativa o tema de receituário institucional (índice 1, configurado via
 * /v1/opcoes-receituario) antes de cada prescrição. Best-effort: falha aqui
 * não pode impedir a abertura da prescrição.
 *
 * cache DEVE permanecer false — o SDK não pode servir uma resposta em cache
 * de uma ativação de tema anterior (ex.: outro prescritor/sessão).
 */
export async function activatePrescriptionTheme(): Promise<void> {
  if (!window.MdHub?.command?.send) return;
  try {
    await Promise.race([
      window.MdHub.command.send('plataforma.sdk', 'find', {
        resource: 'opcoes-receituario/ativar/1',
        cache: false,
      }) as Promise<unknown>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('activatePrescriptionTheme timeout')), THEME_TIMEOUT_MS),
      ),
    ]);
  } catch {
    // comando opcional — não bloqueia a abertura da prescrição
  }
}
