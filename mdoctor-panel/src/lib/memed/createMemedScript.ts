import type { MemedScriptConfig } from './types';
import { rememberMemedScriptUrl, shouldInjectNewScript, syncMemedScriptToken } from './memedSession';

/** Bloqueia window.print e qualquer iframe criado pela Memed antes do script carregar. */
function installPrintBlocker(): void {
  if (typeof window === 'undefined') return;

  // 1. Bloqueia window.print no frame principal.
  window.print = () => {
    console.warn('[MEMED PRINT BLOCKED] window.print interceptado');
  };

  // 2. Helper: tenta sobrescrever print dentro do iframe (falha silenciosa para cross-origin).
  function blockIframePrint(iframe: HTMLIFrameElement): void {
    const apply = () => {
      try {
        if (iframe.contentWindow) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (iframe.contentWindow as any).print = () => {
            console.warn('[MEMED PRINT BLOCKED] iframe.contentWindow.print interceptado');
          };
        }
      } catch {
        // Cross-origin: não é possível — ignorar.
      }
    };
    // Tenta imediatamente e novamente no load (se ainda não carregou).
    apply();
    iframe.addEventListener('load', apply);
  }

  // 3. Bloqueia iframes já presentes (caso raro) e todos os futuros via MutationObserver.
  document.querySelectorAll<HTMLIFrameElement>('iframe').forEach(blockIframePrint);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLIFrameElement) {
          blockIframePrint(node);
        }
        // Iframes aninhados dentro de outros elementos adicionados.
        if (node instanceof Element) {
          node.querySelectorAll<HTMLIFrameElement>('iframe').forEach(blockIframePrint);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Injeta script Sinapse uma única vez; atualiza data-token sem remover o script (preserva sessão BirdID). */
export function createMemedScript(
  doctorToken: string,
  config: Pick<MemedScriptConfig, 'scriptUrl' | 'scriptId' | 'primaryColor' | 'containerId'>,
): HTMLScriptElement {
  installPrintBlocker();
  rememberMemedScriptUrl(config.scriptUrl);

  const existing = document.getElementById(config.scriptId) as HTMLScriptElement | null;
  if (existing && !shouldInjectNewScript(config.scriptId, config.scriptUrl)) {
    syncMemedScriptToken(config.scriptId, doctorToken);
    if (config.containerId) existing.setAttribute('data-container', config.containerId);
    existing.setAttribute('data-color', config.primaryColor);
    return existing;
  }

  if (existing?.parentNode) {
    existing.parentNode.removeChild(existing);
  }

  const script = document.createElement('script');
  script.id = config.scriptId;
  script.type = 'text/javascript';
  script.async = true;
  script.src = config.scriptUrl;
  script.setAttribute('data-token', doctorToken);
  script.setAttribute('data-color', config.primaryColor);
  if (config.containerId) {
    script.setAttribute('data-container', config.containerId);
  }
  document.body.appendChild(script);
  syncMemedScriptToken(config.scriptId, doctorToken);
  return script;
}
