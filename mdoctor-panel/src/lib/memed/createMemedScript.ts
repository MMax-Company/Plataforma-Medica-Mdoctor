import type { MemedScriptConfig } from './types';
import { rememberMemedScriptUrl, shouldInjectNewScript, syncMemedScriptToken } from './memedSession';

/** Injeta script Sinapse uma única vez; atualiza data-token sem remover o script (preserva sessão BirdID). */
export function createMemedScript(
  doctorToken: string,
  config: Pick<MemedScriptConfig, 'scriptUrl' | 'scriptId' | 'primaryColor' | 'containerId'>,
): HTMLScriptElement {
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
