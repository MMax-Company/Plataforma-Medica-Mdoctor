'use client';

import { useEffect } from 'react';
import { getMemedConfig, getMemedToken } from '@/services/memed.service';
import { ensureMemedScript, prewarmMemedSubmodules } from '@/lib/memed';

/**
 * Aquece o SDK Memed em background quando a página da fila carrega.
 *
 * Sequência: getConfig + getToken → ensureMemedScript → prewarmMemedSubmodules.
 * prewarmMemedSubmodules chama show() (carrega sub-módulos) e depois hide() após 20s.
 *
 * Efeito: a primeira prescrição do médico encontra os sub-módulos já no DOM e
 * newPrescription completa em < 200ms em vez de timeout de 15s.
 *
 * Falha silenciosa — não bloqueia a fila nem o fluxo de atendimento.
 */
export function useMemedPrewarm(): void {
  useEffect(() => {
    void (async () => {
      try {
        const [memedConfig, auth] = await Promise.all([getMemedConfig(), getMemedToken()]);
        if (!memedConfig.enabled || !auth.token) return;
        await ensureMemedScript(auth.token, {
          scriptUrl: memedConfig.scriptUrl,
          scriptId: 'memedScript',
          containerId: memedConfig.containerId,
          primaryColor: memedConfig.primaryColor || '#1557FF',
        });
        await prewarmMemedSubmodules();
      } catch {
        // Pre-warm é best-effort — erro silencioso.
      }
    })();
  // Sem dependências: executa uma única vez na montagem da página da fila.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
