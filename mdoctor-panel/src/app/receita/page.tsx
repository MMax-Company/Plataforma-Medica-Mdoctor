'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_BASE } from '@/services/api';
import { requireSession } from '@/services/auth.service';
import { getMemedConfig, getMemedToken, saveMemedReceipt, type MemedConfig } from '@/services/memed.service';

type Atendimento = {
  id: string;
  paciente_nome: string;
  paciente_telefone?: string;
  paciente_cpf?: string;
  paciente_email?: string;
  condicao?: string;
  risco?: string | null;
  status?: string;
  dados_clinicos?: Record<string, unknown> & {
    medicacao_em_uso?: string;
    doenca_cronica?: string;
  };
};

declare global {
  interface Window {
    MdHub?: {
      command?: { send: (module: string, command: string, payload?: unknown) => Promise<unknown> | unknown };
      module?: { show: (module: string) => void; waitForReady?: () => Promise<void> };
      event?: { add: (event: string, callback: (data: unknown) => void) => void };
    };
    MdSinapsePrescricao?: {
      event?: { add: (event: string, callback: (module: { name?: string }) => void) => void };
      setToken?: (token: string) => void;
    };
    atendimentoAtual?: string;
  }
}

const featureToggles = {
  forceSign: true,
  allowShareModal: true,
  enableAlerts: true,
  historyPrescription: true,
  setPatientAllergy: true,
  showProtocol: true,
  guidesOnboarding: false,
  dropdownSync: false,
  editPatient: false,
  removePatient: false,
  deletePatient: false
};

function cleanDigits(value?: string) {
  return String(value || '').replace(/\D/g, '');
}

function buildPatientPayload(atendimento: Atendimento) {
  const cpf = cleanDigits(atendimento.paciente_cpf);
  return {
    idExterno: atendimento.id,
    nome: atendimento.paciente_nome || 'Paciente sem nome',
    telefone: cleanDigits(atendimento.paciente_telefone) || '11999999999',
    email: atendimento.paciente_email || undefined,
    ...(cpf ? { cpf } : { withoutCpf: true })
  };
}

function ReceitaMemedContent() {
  const searchParams = useSearchParams();
  const atendimentoId = searchParams.get('atendimentoId') || '';
  const [config, setConfig] = useState<MemedConfig | null>(null);
  const [token, setToken] = useState('');
  const [atendimento, setAtendimento] = useState<Atendimento | null>(null);
  const [status, setStatus] = useState('Preparando integração Memed...');
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const scriptLoaded = useRef(false);
  const eventsRegistered = useRef(false);

  const patientPayload = useMemo(() => (atendimento ? buildPatientPayload(atendimento) : null), [atendimento]);

  useEffect(() => {
    async function bootstrap() {
      setError(null);
      try {
        await requireSession();
        const [memedConfig, auth] = await Promise.all([getMemedConfig(), getMemedToken()]);
        setConfig(memedConfig);
        setToken(auth.token);

        if (atendimentoId) {
          const response = await fetch(`${API_BASE}/api/atendimentos/${atendimentoId}`);
          const data = await response.json();
          if (!response.ok || !data.success) throw new Error(data.error || 'Atendimento não encontrado');
          setAtendimento(data.atendimento);
          window.atendimentoAtual = atendimentoId;
        }

        setStatus(memedConfig.enabled ? 'Carregando prescrição embedded...' : 'Memed sem credenciais configuradas.');
      } catch (e: any) {
        setError(e.message || 'Erro ao iniciar Memed');
        setStatus('Integração indisponível');
      }
    }

    bootstrap();
  }, [atendimentoId]);

  useEffect(() => {
    if (!config || !token || scriptLoaded.current) return;

    const existing = document.getElementById('memed-prescription-script');
    if (existing) existing.remove();

    const script = document.createElement('script');
    script.id = 'memed-prescription-script';
    script.src = config.scriptUrl;
    script.async = true;
    script.dataset.token = token;
    script.dataset.container = config.containerId;
    script.dataset.color = config.primaryColor;

    script.addEventListener('load', () => {
      scriptLoaded.current = true;
      setStatus('Script Memed carregado. Aguardando módulo de prescrição...');
      registerModuleInit();
    });

    script.addEventListener('error', () => {
      setError('Não foi possível carregar o script da Memed. Verifique domínio liberado, HTTPS e credenciais.');
      setStatus('Falha ao carregar Memed');
    });

    document.body.appendChild(script);
  }, [config, token, patientPayload]);

  function registerModuleInit() {
    const onModuleReady = async (module?: { name?: string }) => {
      if (module?.name && module.name !== 'plataforma.prescricao') return;
      await openPrescription();
    };

    if (window.MdSinapsePrescricao?.event?.add) {
      window.MdSinapsePrescricao.event.add('core:moduleInit', onModuleReady);
      return;
    }

    setTimeout(() => {
      if (window.MdHub?.command?.send) onModuleReady({ name: 'plataforma.prescricao' });
    }, 800);
  }

  async function registerEvents() {
    if (eventsRegistered.current || !window.MdHub?.event?.add) return;
    eventsRegistered.current = true;

    window.MdHub.event.add('prescricaoImpressa', async (payload: unknown) => {
      const data = payload as any;
      const receitaId = data?.id || data?.prescription?.id || data?.prescricao?.id;
      const receitaUrl = data?.url || data?.link || data?.prescription?.url || data?.prescricao?.url;

      if (atendimentoId) {
        await saveMemedReceipt({
          atendimentoId,
          receitaId,
          receitaUrl,
          pdfUrl: data?.pdf || data?.pdf_url || data?.prescription?.pdf,
          payload
        });
      }

      setStatus('Prescrição impressa e vinculada ao atendimento.');
    });
  }

  async function openPrescription() {
    if (!window.MdHub?.command?.send || !window.MdHub?.module?.show) {
      setStatus('MdHub ainda não está pronto.');
      return;
    }

    await registerEvents();

    if (patientPayload) {
      await window.MdHub.command.send('plataforma.prescricao', 'setPaciente', patientPayload);
    }

    await window.MdHub.command.send('plataforma.prescricao', 'setFeatureToggle', featureToggles);
    window.MdHub.module.show('plataforma.prescricao');
    setReady(true);
    setStatus('Memed pronta para prescrição.');
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] p-6 text-[#1E1E1E]">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <a href={atendimentoId ? `/atendimento/${atendimentoId}` : '/fila'} className="text-sm font-semibold text-[#1557FF]">
            Voltar
          </a>
          <h1 className="mt-2 text-2xl font-bold">Prescrição Memed</h1>
          <p className="text-sm text-[#5B6475]">{status}</p>
        </div>
        <button
          onClick={openPrescription}
          disabled={!scriptLoaded.current}
          className="h-11 rounded-[14px] bg-[#1557FF] px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {ready ? 'Reabrir Memed' : 'Abrir Memed'}
        </button>
      </div>

      {error && <div className="mb-4 rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <aside className="rounded-[20px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
          <h2 className="text-base font-bold">Atendimento</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-semibold text-[#5B6475]">Paciente</dt>
              <dd className="mt-1 font-bold">{atendimento?.paciente_nome || 'Não selecionado'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#5B6475]">Condição</dt>
              <dd className="mt-1">{atendimento?.condicao || atendimento?.dados_clinicos?.doenca_cronica || 'Não informada'}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#5B6475]">Medicação em uso</dt>
              <dd className="mt-1">{String(atendimento?.dados_clinicos?.medicacao_em_uso || 'Não informada')}</dd>
            </div>
            <div>
              <dt className="font-semibold text-[#5B6475]">Risco</dt>
              <dd className="mt-1">{atendimento?.risco || 'Não definido'}</dd>
            </div>
          </dl>
        </aside>

        <div className="overflow-auto rounded-[20px] border border-[#E5EAF2] bg-white p-4 shadow-[0_4px_14px_rgba(0,0,0,0.04)]">
          <div
            id={config?.containerId || 'prescricao-memed'}
            className="relative h-[calc(100vh-190px)] min-h-[700px] min-w-[820px] bg-white"
          />
        </div>
      </section>
    </main>
  );
}

export default function ReceitaPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F8FAFC] p-6 text-sm text-[#5B6475]">Carregando...</main>}>
      <ReceitaMemedContent />
    </Suspense>
  );
}
