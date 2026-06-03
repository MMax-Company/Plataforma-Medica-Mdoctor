/**
 * Runtime global MdHub — uma instância por aba do painel (padrão memed-react, sem MemedProvider).
 * Não remove script, não faz logout, não limpa storage Memed.
 */
import { createMemedScript } from './createMemedScript';
import { markMemedModuleReady, rememberMemedScriptUrl, syncMemedScriptToken } from './memedSession';
import { PRESCRIPTION_MODULE } from './onLoadPrescription';
import type { MemedScriptConfig } from './types';

type ScriptConfig = Pick<MemedScriptConfig, 'scriptUrl' | 'scriptId' | 'primaryColor' | 'containerId'>;

const state = {
  scriptId: 'memedScript',
  initPromise: null as Promise<void> | null,
  moduleReady: false,
  moduleReadyWaiters: [] as Array<() => void>,
  moduleInitBound: false,
};

function resolveModuleReady() {
  state.moduleReady = true;
  markMemedModuleReady(true);
  state.moduleReadyWaiters.splice(0).forEach((fn) => fn());
}

export function bindModuleInitOnce(): void {
  if (state.moduleInitBound || typeof window === 'undefined') return;
  if (!window.MdSinapsePrescricao?.event?.add) return;

  window.MdSinapsePrescricao.event.add('core:moduleInit', (modulo: { name?: string }) => {
    if (modulo?.name === PRESCRIPTION_MODULE) {
      resolveModuleReady();
    }
  });
  state.moduleInitBound = true;
}

export function waitForMemedModuleReady(): Promise<void> {
  if (state.moduleReady) return Promise.resolve();
  return new Promise((resolve) => {
    state.moduleReadyWaiters.push(resolve);
  });
}

/** Carrega script uma vez; atualiza token sem reinjetar. */
export function ensureMemedScript(token: string, config: ScriptConfig): Promise<void> {
  if (!token) return Promise.reject(new Error('Token Memed ausente'));

  rememberMemedScriptUrl(config.scriptUrl);

  if (state.initPromise) {
    syncMemedScriptToken(config.scriptId || state.scriptId, token);
    return state.initPromise;
  }

  state.initPromise = new Promise((resolve, reject) => {
    try {
      const script = createMemedScript(token, {
        ...config,
        scriptId: config.scriptId || state.scriptId,
      });

      const onReady = () => {
        bindModuleInitOnce();
        if (state.moduleReady) {
          resolve();
          return;
        }
        waitForMemedModuleReady().then(resolve);
      };

      script.addEventListener('load', onReady);
      if (script.getAttribute('data-loaded') === 'true') {
        bindModuleInitOnce();
        if (state.moduleReady) resolve();
        else waitForMemedModuleReady().then(resolve);
      }
    } catch (error) {
      state.initPromise = null;
      reject(error);
    }
  });

  return state.initPromise;
}

export function isMemedRuntimeReady() {
  return state.moduleReady;
}

export function resetMemedRuntimeForTestsOnly() {
  state.initPromise = null;
  state.moduleReady = false;
  state.moduleInitBound = false;
  markMemedModuleReady(false);
}
