import type { MemedScriptConfig } from './types';
import { rememberMemedScriptUrl, shouldInjectNewScript, syncMemedScriptToken } from './memedSession';

/** Intercepta window.fetch para unleash-proxy — devolve { toggles: [] } sem rede, impedindo hang do SDK. */
function installUnleashBypass(): void {
  if (typeof window === 'undefined' || (window as any).__unleashBypassed) return; // eslint-disable-line @typescript-eslint/no-explicit-any
  (window as any).__unleashBypassed = true; // eslint-disable-line @typescript-eslint/no-explicit-any
  const orig = window.fetch.bind(window);
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (url.includes('unleash-proxy')) {
      return Promise.resolve(new Response(JSON.stringify({ toggles: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return orig(input, init);
  };
  console.log('[UNLEASH BYPASS INSTALLED]');
}

/** Bloqueia window.print no frame pai e nos iframes da Memed antes do script carregar. */
function installPrintBlocker(): void {
  if (typeof window === 'undefined') return;

  // 1. Bloqueia window.print e globalThis.print do frame pai.
  //    Getter sempre retorna noop; setter é no-op — impede restauração mesmo em strict mode,
  //    inclusive pelo cleanup do useEffect em MemedEmissionOverlay.
  const parentNoop = () => { console.warn('[PRINT BLOCKED parent] window.print interceptado'); };
  try {
    Object.defineProperty(window, 'print', {
      get: () => parentNoop,
      set: () => { /* prevent any code from restoring native print */ },
      configurable: false,
      enumerable: true,
    });
  } catch {
    window.print = parentNoop;
  }
  try { (globalThis as any).print = parentNoop; } catch {} // eslint-disable-line @typescript-eslint/no-explicit-any

  // 2. Patch HTMLIFrameElement.prototype.contentWindow getter para interceptar print
  //    antes de qualquer acesso (cobre iframes same-origin que podem mudar de origin).
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (desc?.get) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get() {
          const cw = desc.get!.call(this);
          if (cw) {
            try {
              (cw as any).print = () => { console.warn('[PRINT BLOCKED iframe] contentWindow.print interceptado'); }; // eslint-disable-line @typescript-eslint/no-explicit-any
            } catch {}
          }
          return cw;
        },
        configurable: true,
      });
    }
  } catch {}

  // 3. Aplica sandbox sem allow-modals nos iframes da Memed via MutationObserver.
  //    Sem allow-modals, window.print() dentro do iframe cross-origin é bloqueado pelo
  //    browser antes mesmo de tentar — única solução efetiva para iframes cross-origin.
  function patchIframe(iframe: HTMLIFrameElement): void {
    const memedContainer = document.getElementById('prescricao-memed');
    const src = iframe.getAttribute('src') ?? '';
    const isMemedRelated =
      (memedContainer != null && memedContainer.contains(iframe)) ||
      src.includes('memed') ||
      src.includes('sinapse') ||
      src.includes('birdid');
    if (!isMemedRelated) return;

    if (!iframe.hasAttribute('sandbox')) {
      iframe.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-popups-to-escape-sandbox allow-pointer-lock',
      );
    }
    const apply = () => {
      try {
        if (iframe.contentWindow) {
          (iframe.contentWindow as any).print = () => { // eslint-disable-line @typescript-eslint/no-explicit-any
            console.warn('[PRINT BLOCKED iframe] iframe.contentWindow.print interceptado');
          };
        }
      } catch {}
    };
    apply();
    iframe.addEventListener('load', apply);
  }

  document.querySelectorAll<HTMLIFrameElement>('iframe').forEach(patchIframe);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLIFrameElement) patchIframe(node);
        if (node instanceof Element) node.querySelectorAll<HTMLIFrameElement>('iframe').forEach(patchIframe);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  console.log('[PRINT BLOCKER INSTALLED]');
}

/** Injeta script Sinapse uma única vez; atualiza data-token sem remover o script (preserva sessão BirdID). */
export function createMemedScript(
  doctorToken: string,
  config: Pick<MemedScriptConfig, 'scriptUrl' | 'scriptId' | 'primaryColor' | 'containerId'>,
): HTMLScriptElement {
  installUnleashBypass();
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
