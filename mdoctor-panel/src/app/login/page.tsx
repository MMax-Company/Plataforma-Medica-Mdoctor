'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, LockKeyhole, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { BrandLogo } from '@/components/ui/Brand';
import { Button } from '@/components/ui/button';
import { clearSession, hasValidSession, login } from '@/services/auth.service';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('mdoctor_panel_mock_session');
      const remembered = window.localStorage.getItem('mdoctor_login_remember');
      if (remembered) setIdentifier(remembered);
    }
  }, []);

  useEffect(() => {
    if (hasValidSession()) {
      router.replace('/fila');
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!identifier.trim() || !password.trim()) {
      setError('Informe usuário e senha para continuar.');
      return;
    }

    setLoading(true);

    try {
      clearSession();
      await login(identifier.trim(), password);
      if (remember) {
        window.localStorage.setItem('mdoctor_login_remember', identifier.trim());
      } else {
        window.localStorage.removeItem('mdoctor_login_remember');
      }
      router.replace('/fila');
    } catch (loginError) {
      if (loginError instanceof Error) {
        setError(loginError.message);
      } else {
        setError('Falha no login');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[#F8FAFC] text-[#1E1E1E] lg:grid-cols-[1.02fr_0.98fr]">
      <section className="relative hidden overflow-hidden bg-[#F8FAFC] px-12 py-12 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(21,87,255,0.16),transparent_36%),radial-gradient(circle_at_78%_74%,rgba(244,176,0,0.14),transparent_32%)]" />
        <div className="absolute left-16 top-44 h-36 w-36 rounded-full border border-[#D9E2F0]" />
        <div className="absolute bottom-24 right-20 h-56 w-56 rounded-full border border-[#E5EAF2]" />

        <div className="relative z-10">
          <BrandLogo size="lg" />

          <div className="mt-16 max-w-xl">
            <h1 className="text-5xl font-bold leading-tight text-[#1E1E1E]">
              Sua plataforma completa para prescrição e atendimento médico.
            </h1>
            <p className="mt-5 text-base leading-7 text-[#5B6475]">
              Fluxo clínico seguro, eficiente e orientado à prática médica com baixa carga cognitiva.
            </p>
          </div>
        </div>

        <div className="relative z-10 grid max-w-xl gap-5">
          {[
            { title: 'Segurança e privacidade', description: 'Seus dados protegidos com nível hospitalar.', Icon: ShieldCheck },
            { title: 'Atendimento eficiente', description: 'Gerencie consultas e prescrições com agilidade.', Icon: Zap },
            { title: 'Tudo em um só lugar', description: 'Prontuário, receitas e histórico de pacientes.', Icon: CheckCircle2 },
          ].map(({ title, description, Icon }) => (
            <div key={title} className="flex items-center gap-4 rounded-lg border border-[#E5EAF2] bg-white/80 p-4 shadow-sm">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#EEF4FF] text-[#1557FF]">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-[#253044]">{title}</p>
                <p className="mt-1 text-sm text-[#5B6475]">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex min-h-screen flex-col items-center justify-center px-6 py-8">
        <form
          onSubmit={handleSubmit}
          className="relative w-full max-w-[520px] rounded-[20px] border border-[#E5EAF2] bg-white p-8 shadow-[0_24px_80px_rgba(37,48,68,0.10)]"
        >
          <span className="absolute inset-x-0 bottom-0 h-2 rounded-b-[20px] bg-[#F4B000]" />
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#EEF4FF] text-[#1557FF]">
              <LockKeyhole className="h-8 w-8" aria-hidden="true" />
            </div>
            <h2 className="text-2xl font-bold text-[#1E1E1E]">Acesso ao Painel Médico</h2>
            <p className="mt-2 text-sm text-[#5B6475]">Ambiente operacional staging</p>
          </div>

          {error && (
            <div className="mb-5 rounded-md border border-[#FFD1D1] bg-[#FFECEC] px-4 py-3 text-sm font-semibold text-[#B91C1C]">
              {error}
            </div>
          )}

          <div className="space-y-5">
            <label className="block text-sm font-semibold text-[#253044]">
              Usuário
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                className="mt-2 h-12 w-full rounded-md border border-[#D9E2F0] bg-[#F8FAFC] px-4 text-sm text-[#253044] outline-none transition-colors placeholder:text-[#8A94A6] focus:border-[#1557FF] focus:bg-white"
                placeholder="drmax.matos"
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
                Lembrar usuário
              </label>
            </div>

            <Button type="submit" className="h-12 w-full text-sm font-bold" disabled={loading}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {loading ? 'ACESSANDO...' : 'ACESSAR PAINEL'}
            </Button>
          </div>
        </form>

        <footer className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium text-[#5B6475]">
          <span>Doctor Prescreve — Plataforma de Prescrição Médica</span>
          <span>CNPJ: 50.871.173/0001-53</span>
          <span>© 2025 Todos os direitos reservados.</span>
        </footer>
      </section>
    </main>
  );
}
