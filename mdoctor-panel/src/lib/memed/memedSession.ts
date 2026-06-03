/** Estado global do widget — evita logout/reinício ao trocar atendimento na mesma aba. */
const DEFAULT_SCRIPT_ID = 'memedScript';

type MemedSessionState = {
  scriptId: string;
  scriptUrl: string | null;
  moduleReady: boolean;
  lastToken: string;
};

const state: MemedSessionState = {
  scriptId: DEFAULT_SCRIPT_ID,
  scriptUrl: null,
  moduleReady: false,
  lastToken: '',
};

export function getMemedScriptId() {
  return state.scriptId;
}

export function markMemedModuleReady(ready: boolean) {
  state.moduleReady = ready;
}

export function isMemedModuleReady() {
  return state.moduleReady;
}

export function rememberMemedScriptUrl(url: string) {
  state.scriptUrl = url;
}

export function getMemedScriptUrl() {
  return state.scriptUrl;
}

export function rememberMemedToken(token: string) {
  state.lastToken = token;
}

export function getLastMemedToken() {
  return state.lastToken;
}

export function syncMemedScriptToken(scriptId: string, token: string) {
  const script = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (!script) return;
  script.setAttribute('data-token', token);
  window.MdSinapsePrescricao?.setToken?.(token);
  state.lastToken = token;
}

export function shouldInjectNewScript(scriptId: string, scriptUrl: string) {
  const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (!existing) return true;
  if (state.scriptUrl && state.scriptUrl !== scriptUrl) return true;
  return false;
}
