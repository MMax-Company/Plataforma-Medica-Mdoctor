/**
 * Runtime global MdHub — uma instância por aba do painel (padrão memed-react, sem MemedProvider).
 * Não remove script, não faz logout, não limpa storage Memed.
 */
import { createMemedScript } from './createMemedScript';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import {
  getLastMemedToken,
  markMemedModuleReady,
  rememberMemedScriptUrl,
  rememberMemedToken,
  syncMemedScriptToken,
} from './memedSession';
import { PRESCRIPTION_MODULE } from './onLoadPrescription';
import type { MemedScriptConfig } from './types';

type ScriptConfig = Pick<MemedScriptConfig, 'scriptUrl' | 'scriptId' | 'primaryColor' | 'containerId'>;

const state = {
  scriptId: 'memedScript',
  initPromise: null as Promise<void> | null,
  moduleReady: false,
  moduleReadyWaiters: [] as Array<() => void>,
  moduleInitBound: false,
  lastEmissionAt: 0,
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
    // Log every core:moduleInit — including repeats after newPrescription — to diagnose
    // whether patient-management reinitializes between newPrescription and setPaciente calls.
    pushDiagnosticEvent('core:moduleInit', {
      moduleName: modulo?.name,
      isPrescricao: modulo?.name === PRESCRIPTION_MODULE,
      alreadyReady: state.moduleReady,
      iframes: captureIframeState(),
    });
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
    const tokenChanged = token !== getLastMemedToken();
    pushDiagnosticEvent('ensureMemedScript:warm', {
      tokenChanged,
      moduleReady: state.moduleReady,
      iframes: captureIframeState(),
    });
    // Só chama syncMemedScriptToken se o token mudou de fato.
    // setToken() do SDK Memed (sinapse-prescricao.min.js) faz iframe.src = iframe.src
    // (reload completo) quando há iframes presentes — mesmo com o mesmo token.
    if (tokenChanged) {
      syncMemedScriptToken(config.scriptId || state.scriptId, token);
    }
    return state.initPromise;
  }

  state.initPromise = new Promise((resolve, reject) => {
    try {
      // Grava o token imediatamente ao injetar o script.
      // Sem isso, getLastMemedToken() retorna '' quando o warm path é atingido
      // no paciente 2 — forçando um syncMemedScriptToken desnecessário.
      rememberMemedToken(token);

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
  state.lastEmissionAt = 0;
  markMemedModuleReady(false);
}

/** Chamado quando prescricaoImpressa dispara. Usado para calcular janela de estabilização. */
export function recordMemedPrescriptionEmission(): void {
  state.lastEmissionAt = Date.now();
}

/** true se ao menos uma emissão ocorreu nesta sessão de browser. */
export function wasMemedPrescriptionEmittedThisSession(): boolean {
  return state.lastEmissionAt > 0;
}

/**
 * Retorna quantos ms ainda faltam para a janela de estabilização pós-emissão expirar.
 * Retorna 0 se nenhuma emissão ocorreu ou se a janela já passou.
 */
export function msUntilPostEmissionSettle(settleMs: number): number {
  if (state.lastEmissionAt === 0) return 0;
  const elapsed = Date.now() - state.lastEmissionAt;
  return Math.max(0, settleMs - elapsed);
}
