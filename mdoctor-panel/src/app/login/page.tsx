'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, LockKeyhole, Sparkles, Stethoscope } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { clearSession, getAuthToken, isOfflineAuthError, login, saveSession } from '@/services/auth.service';

const MOCK_SESSION_KEY = 'mdoctor_panel_mock_session';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (getAuthToken() || window.localStorage.getItem(MOCK_SESSION_KEY)) {
      router.replace('/dashboard');
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!identifier.trim() || !password.trim()) {
      setError('Informe e-mail ou CPF e senha para continuar.');
      return;
    }

    setLoading(true);

    try {
      clearSession();
      const session = await login(identifier.trim(), password);
      window.localStorage.setItem(
        MOCK_SESSION_KEY,
        JSON.stringify({
          identifier: identifier.trim(),
          remember,
          token: session.token,
          mode: 'jwt',
          authenticatedAt: new Date().toISOString(),
        }),
      );
      router.replace('/dashboard');
    } catch (loginError) {
      if (!isOfflineAuthError(loginError)) {
        setError(loginError instanceof Error ? loginError.message : 'Falha no login');
        setLoading(false);
        return;
      }

      const mockToken = `mock-local-${Date.now()}`;
      saveSession({
        token: mockToken,
        user: {
          id: identifier.trim(),
          name: identifier.trim(),
          username: identifier.trim(),
          role: 'admin',
        },
      });
      window.localStorage.setItem(
        MOCK_SESSION_KEY,
        JSON.stringify({
          identifier: identifier.trim(),
          remember,
          token: mockToken,
          mode: 'mock',
          authenticatedAt: new Date().toISOString(),
        }),
      );
      router.replace('/dashboard');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#F8FAFC] text-[#1E1E1E] lg:grid-cols-[1.03fr_0.97fr]">
      <section className="relative hidden overflow-hidden bg-[#F8FAFC] px-16 py-14 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(21,87,255,0.14),transparent_32%),radial-gradient(circle_at_78%_74%,rgba(244,176,0,0.16),transparent_30%)]" />
        <div className="absolute left-20 top-48 h-36 w-36 rounded-full border border-[#D9E2F0]" />
        <div className="absolute bottom-20 right-20 h-56 w-56 rounded-full border border-[#E5EAF2]" />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#1557FF] text-white">
              <Stethoscope className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xl font-bold text-[#1E1E1E]">Doctor Prescreve</p>
              <p className="text-sm font-semibold text-[#1557FF]">Painel Medico</p>
            </div>
          </div>

          <div className="mt-20 max-w-xl">
            <h1 className="text-4xl font-bold leading-tight text-[#1E1E1E]">
              Sua plataforma completa para prescricao e atendimento medico.
            </h1>
            <p className="mt-5 text-base leading-7 text-[#5B6475]">
              Um ambiente operacional limpo para revisar pacientes, validar prontuarios e liberar receitas com seguranca.
            </p>
          </div>
        </div>

        <div className="relative z-10 grid max-w-xl gap-5">
          {[
            ['Seguranca e privacidade', 'Fluxo protegido para rotina medica e dados sensiveis.'],
            ['Atendimento eficiente', 'Fila, prontuario e prescricao conectados em poucos cliques.'],
            ['Tudo em um so lugar', 'Da triagem ao envio da receita, sem ruido operacional.'],
          ].map(([title, description]) => (
            <div key={title} className="flex items-center gap-4 rounded-lg border border-[#E5EAF2] bg-white/80 p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#EEF4FF] text-[#1557FF]">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-[#253044]">{title}</p>
                <p className="mt-1 text-sm text-[#5B6475]">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-[520px] rounded-lg border border-[#E5EAF2] bg-white p-8 shadow-[0_24px_80px_rgba(37,48,68,0.10)]"
        >
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#1557FF]">
              <LockKeyhole className="h-8 w-8" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-[#1E1E1E]">Acesso ao Painel Medico</h2>
            <p className="mt-2 text-sm text-[#5B6475]">Informe suas credenciais para continuar</p>
          </div>

          {error && (
            <div className="mb-5 rounded-md border border-[#FFD1D1] bg-[#FFECEC] px-4 py-3 text-sm font-semibold text-[#B91C1C]">
              {error}
            </div>
          )}

          <div className="space-y-5">
            <label className="block text-sm font-semibold text-[#253044]">
              E-mail ou CPF
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                className="mt-2 h-12 w-full rounded-md border border-[#D9E2F0] bg-[#F8FAFC] px-4 text-sm text-[#253044] outline-none transition-colors placeholder:text-[#8A94A6] focus:border-[#1557FF] focus:bg-white"
                placeholder="Digite seu e-mail ou CPF"
              />
            </label>

            <label className="block text-sm font-semibold text-[#253044]">
              Senha
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className="mt-2 h-12 w-full rounded-md border border-[#D9E2F0] bg-[#F8FAFC] px-4 text-sm text-[#253044] outline-none transition-colors placeholder:text-[#8A94A6] focus:border-[#1557FF] focus:bg-white"
                placeholder="Digite sua senha"
              />
            </label>

            <div className="flex items-center justify-between gap-4 text-sm">
              <label className="flex items-center gap-2 text-[#5B6475]">
                <input
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  type="checkbox"
                  className="h-4 w-4 rounded border-[#D9E2F0]"
                />
                Lembrar meus dados
              </label>
              <button type="button" className="font-semibold text-[#1557FF] hover:text-[#0f49df]">
                Esqueci minha senha
              </button>
            </div>

            <Button className="h-12 w-full text-sm font-bold" disabled={loading}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {loading ? 'ACESSANDO...' : 'ACESSAR PAINEL'}
            </Button>
          </div>
        </form>

        <footer className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs font-medium text-[#5B6475]">
          <span>Doctor Prescreve</span>
          <span>CNPJ: 50.871.173/0001-53</span>
          <span>Copyright 2026</span>
        </footer>
      </section>
    </main>
  );
}
