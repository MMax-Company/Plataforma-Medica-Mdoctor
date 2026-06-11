/**
 * Runtime global MdHub — uma instância por aba do painel (padrão memed-react, sem MemedProvider).
 * Não remove script, não faz logout, não limpa storage Memed.
 */
import { createMemedScript } from './createMemedScript';
import { captureIframeState, pushDiagnosticEvent } from './memedCommandDiagnostic';
import {
  markMemedModuleReady,
  rememberMemedScriptUrl,
  rememberMemedToken,
} from './memedSession';
import { PRESCRIPTION_MODULE } from './onLoadPrescription';
import type { MemedScriptConfig } from './types';

type ScriptConfig = Pick<MemedScriptConfig, 'scriptUrl' | 'scriptId' | 'primaryColor' | 'containerId'>;

const state = {
  scriptId: 'memedScript',
  containerId: 'prescricao-memed',
  initPromise: null as Promise<void> | null,
  moduleReady: false,
  moduleReadyWaiters: [] as Array<() => void>,
  moduleInitBound: false,
  moduleHideBound: false,
  lastEmissionAt: 0,
  prescriptionShownOnce: false,
  /** true se prescricaoImpressa disparou no ciclo atual — limpo ao iniciar o próximo paciente. */
  lastCycleHadEmission: false,
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

/**
 * Diretriz oficial Memed: addCoreModuleHideCallback deve validar module.moduleName
 * (não module.name). Quando o módulo é destruído (após hide()), reseta o estado de pronto
 * para que waitForModuleReinit() espere o próximo core:moduleInit antes de prosseguir.
 */
export function bindModuleHideOnce(): void {
  if (state.moduleHideBound || typeof window === 'undefined') return;
  if (!window.MdSinapsePrescricao?.event?.add) return;

  window.MdSinapsePrescricao.event.add('core:moduleHide', (modulo) => {
    pushDiagnosticEvent('core:moduleHide', {
      moduleName: modulo?.moduleName,
      isPrescricao: modulo?.moduleName === PRESCRIPTION_MODULE,
      iframes: captureIframeState(),
    });
    if (modulo?.moduleName === PRESCRIPTION_MODULE) {
      state.moduleReady = false;
      markMemedModuleReady(false);
    }
  });
  state.moduleHideBound = true;
}

export function waitForMemedModuleReady(): Promise<void> {
  if (state.moduleReady) return Promise.resolve();
  return new Promise((resolve) => {
    state.moduleReadyWaiters.push(resolve);
  });
}

/**
 * Hard reset do container Memed: remove todos os iframes/filhos injetados pelo SDK.
 * Usado após emissão real (prescricaoImpressa) para garantir que o próximo paciente
 * encontre o widget completamente em branco — sem imagem de receita anterior.
 * Não depende de eventos do SDK; opera diretamente no DOM.
 */
/**
 * Força ocultamento visual imediato do container Memed via CSS inline.
 * Chamado no tick síncrono de prescricaoImpressa, antes de qualquer re-render
 * React, para garantir que a tela de sucesso do SDK nunca seja visível.
 * O CSS é removido por hardResetMemedContainer() antes do próximo show().
 */
export function forceHideMemedContainer(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(state.containerId);
  if (!el) return;
  el.style.setProperty('display', 'none', 'important');
  el.style.setProperty('opacity', '0', 'important');
  el.style.setProperty('visibility', 'hidden', 'important');
}

export function hardResetMemedContainer(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(state.containerId);
  if (!el) return;
  // Remove CSS de force-hide para não bloquear o próximo show().
  el.style.removeProperty('display');
  el.style.removeProperty('opacity');
  el.style.removeProperty('visibility');
  while (el.firstChild) el.removeChild(el.firstChild);
  pushDiagnosticEvent('hardReset:containerCleared', {
    containerId: state.containerId,
    iframes: captureIframeState(),
  });
}

/** Carrega script uma vez; atualiza token sem reinjetar. */
export function ensureMemedScript(token: string, config: ScriptConfig): Promise<void> {
  if (!token) return Promise.reject(new Error('Token Memed ausente'));

  rememberMemedScriptUrl(config.scriptUrl);
  if (config.containerId) state.containerId = config.containerId;

  if (state.initPromise) {
    pushDiagnosticEvent('ensureMemedScript:warm', {
      moduleReady: state.moduleReady,
      iframes: captureIframeState(),
    });
    // Script inicializado uma única vez por sessão — não recarregar nem sincronizar token
    // (setToken() causa iframe.src = iframe.src, disparando core:moduleInit extra que
    // interfere no ciclo hide → reinit do multi-paciente).
    return state.initPromise;
  }

  state.initPromise = new Promise((resolve, reject) => {
    try {
      rememberMemedToken(token);

      const script = createMemedScript(token, {
        ...config,
        scriptId: config.scriptId || state.scriptId,
      });

      const onReady = () => {
        bindModuleInitOnce();
        bindModuleHideOnce();
        if (state.moduleReady) {
          resolve();
          return;
        }
        waitForMemedModuleReady().then(resolve);
      };

      script.addEventListener('load', onReady);
      if (script.getAttribute('data-loaded') === 'true') {
        bindModuleInitOnce();
        bindModuleHideOnce();
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
  state.prescriptionShownOnce = false;
  markMemedModuleReady(false);
}

/**
 * Indica que o widget foi exibido pelo menos uma vez nesta sessão.
 * Após o primeiro show(), hide() remove os iframes do DOM.
 * Qualquer prescrição subsequente precisa chamar show() ANTES dos comandos MdHub.
 */
export function markPrescriptionShownOnce(): void {
  state.prescriptionShownOnce = true;
}

/** true se o widget já foi exibido (e portanto ocultado) ao menos uma vez. */
export function wasPrescriptionShownBefore(): boolean {
  return state.prescriptionShownOnce;
}

/**
 * Para pacientes subsequentes (P2+): reseta o estado de pronto e aguarda o próximo
 * core:moduleInit, que dispara após hide() destruir e reinicializar o módulo.
 *
 * Fluxo oficial Memed multi-paciente:
 *   waitForModuleReinit() → hidePrescription() → core:moduleHide → core:moduleInit → resolve
 *
 * DEVE ser chamado ANTES de hidePrescription() para que o waiter esteja registrado
 * quando o evento core:moduleInit disparar.
 */
export function waitForModuleReinit(timeoutMs: number): Promise<void> {
  state.moduleReady = false;
  markMemedModuleReady(false);
  return Promise.race([
    waitForMemedModuleReady(),
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout ${timeoutMs}ms aguardando reinicialização do módulo Memed após hide`)),
        timeoutMs,
      ),
    ),
  ]);
}

/** @deprecated Use waitForModuleReinit. */
export function resetModuleReadyAndGetWaitPromise(timeoutMs: number): Promise<void> {
  return waitForModuleReinit(timeoutMs);
}

/** Chamado quando prescricaoImpressa dispara. Usado para calcular janela de estabilização. */
export function recordMemedPrescriptionEmission(): void {
  state.lastEmissionAt = Date.now();
  state.lastCycleHadEmission = true;
}

/** true se o ciclo atual terminou com emissão real (prescricaoImpressa). */
export function wasLastCycleEmitted(): boolean {
  return state.lastCycleHadEmission;
}

/** Consome o flag — chamar no início de cada novo ciclo de prepareAndShowPrescription. */
export function clearLastCycleEmitted(): void {
  state.lastCycleHadEmission = false;
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
