'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Shield,
  User,
  Zap,
} from 'lucide-react';
import { clearSession, login, validateSession } from '@/services/auth.service';
import { defaultRedirectForRole } from '@/hooks/useRequireRole';

const LOGO_SRC = '/doctor-prescreve-logo-transparent.png';

const FEATURES = [
  {
    title: 'Segurança e privacidade',
    description: 'Seus dados protegidos com nível hospitalar.',
    Icon: Shield,
  },
  {
    title: 'Atendimento eficiente',
    description: 'Gerencie consultas e prescrições com agilidade.',
    Icon: Zap,
  },
  {
    title: 'Tudo em um só lugar',
    description: 'Prontuário, receitas e histórico de pacientes.',
    Icon: FileText,
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
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
    let cancelled = false;
    validateSession().then((user) => {
      if (!cancelled && user) router.replace(defaultRedirectForRole(user.role));
    });
    return () => {
      cancelled = true;
    };
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
      const session = await login(identifier.trim(), password);
      if (remember) {
        window.localStorage.setItem('mdoctor_login_remember', identifier.trim());
      } else {
        window.localStorage.removeItem('mdoctor_login_remember');
      }
      router.replace(defaultRedirectForRole(session.user.role));
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
    <div className="login-replica-root relative mx-auto w-full max-w-[1366px] bg-[#EEF2F7] text-[#172B4D]">
      <main className="login-replica-main relative z-10">
        <section className="login-replica-left">
          <div className="login-replica-left-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOGO_SRC}
              alt="Doctor Prescreve"
              width={291}
              height={157}
              decoding="async"
              fetchPriority="high"
              className="login-replica-logo block bg-transparent drop-shadow-[0_4px_18px_rgba(23,43,77,0.1)]"
              style={{ background: 'transparent' }}
            />

            <h1 className="login-replica-headline w-full text-center font-bold tracking-[-0.02em] text-[#172B4D]">
              Sua plataforma completa para prescrição e atendimento médico.
            </h1>

            <div className="login-replica-features flex w-full flex-col">
              {FEATURES.map(({ title, description, Icon }) => (
                <div
                  key={title}
                  className="login-replica-feature-card group flex items-center rounded-[18px] border border-[#E6ECF4] bg-white shadow-[0_8px_28px_rgba(23,43,77,0.06)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(23,43,77,0.09)]"
                >
                  <div className="login-replica-feature-icon flex shrink-0 items-center justify-center rounded-full bg-[#E8F1FF] text-[#1557FF] transition-colors duration-300 group-hover:bg-[#DCE9FF]">
                    <Icon strokeWidth={2.15} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-[15px] font-bold leading-tight text-[#172B4D]">{title}</p>
                    <p className="mt-1 text-[13px] leading-snug text-[#64748B]">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="login-replica-right">
          <form
            onSubmit={handleSubmit}
            className="login-replica-form relative flex flex-col rounded-[28px] border border-[#E8EDF4] bg-white shadow-[0_20px_56px_rgba(23,43,77,0.1),0_4px_16px_rgba(23,43,77,0.04)]"
          >
            <span className="login-replica-form-accent absolute bottom-0 rounded-b-[28px] bg-[#F4B000]" aria-hidden />

            <div className="login-replica-form-header text-center">
              <div className="login-replica-form-header-icon mx-auto flex items-center justify-center rounded-full bg-[#E8F1FF] text-[#1557FF]">
                <User strokeWidth={1.75} aria-hidden="true" />
              </div>
              <h2 className="text-[24px] font-bold tracking-[-0.015em] text-[#172B4D]">
                Acesso ao Painel Médico
              </h2>
              <p className="mt-2 text-[14px] font-medium text-[#64748B]">
                Informe suas credenciais para continuar
              </p>
            </div>

            {error && (
              <div className="mb-4 rounded-[12px] border border-[#FFD1D1] bg-[#FFF5F5] px-4 py-3 text-sm font-semibold text-[#B91C1C]">
                {error}
              </div>
            )}

            <div className="login-replica-form-fields flex flex-1 flex-col">
              <label className="block text-[13px] font-semibold text-[#172B4D]">
                E-mail ou CPF
                <div className="relative mt-2">
                  <User
                    className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#94A3B8]"
                    aria-hidden="true"
                  />
                  <input
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    autoComplete="username"
                    className="login-replica-input w-full rounded-[12px] border border-[#D5DFED] bg-white pl-11 pr-4 text-[14px] font-medium text-[#172B4D] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-normal placeholder:text-[#94A3B8] focus:border-[#1557FF] focus:shadow-[0_0_0_4px_rgba(21,87,255,0.1)]"
                    placeholder="Digite seu e-mail ou CPF"
                  />
                </div>
              </label>

              <label className="block text-[13px] font-semibold text-[#172B4D]">
                Senha
                <div className="relative mt-2">
                  <Lock
                    className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#94A3B8]"
                    aria-hidden="true"
                  />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    className="login-replica-input w-full rounded-[12px] border border-[#D5DFED] bg-white pl-11 pr-12 text-[14px] font-medium text-[#172B4D] outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-normal placeholder:text-[#94A3B8] focus:border-[#1557FF] focus:shadow-[0_0_0_4px_rgba(21,87,255,0.1)]"
                    placeholder="Digite sua senha"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:text-[#475569]"
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
                    ) : (
                      <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>

              <div className="login-replica-form-options flex items-center justify-between gap-4 text-[13px]">
                <label className="flex cursor-pointer items-center gap-2.5 font-medium text-[#475569]">
                  <input
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    type="checkbox"
                    className="h-4 w-4 rounded border-[#C5D4E8] accent-[#1557FF]"
                  />
                  Lembrar meus dados
                </label>
                <a
                  href="#"
                  className="font-semibold text-[#1557FF] transition-colors hover:text-[#1248D6] hover:underline"
                  onClick={(e) => e.preventDefault()}
                >
                  Esqueci minha senha
                </a>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="login-replica-submit mt-auto inline-flex w-full items-center justify-center gap-3 rounded-[12px] bg-[#1557FF] text-[14px] font-bold tracking-[0.04em] text-white shadow-[0_8px_24px_rgba(21,87,255,0.35)] transition-all duration-200 hover:-translate-y-px hover:bg-[#1248D6] hover:shadow-[0_10px_28px_rgba(21,87,255,0.42)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                <span className="login-replica-submit-icon flex items-center justify-center rounded-full border border-white/30 bg-white/15">
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                </span>
                {loading ? 'ACESSANDO...' : 'ACESSAR PAINEL'}
              </button>
            </div>
          </form>
        </section>
      </main>

      <footer className="login-replica-footer text-center">
        Doctor Prescreve — Plataforma de Prescrição Médica | CNPJ: 50.871.173/0001-53 | © {new Date().getFullYear()} Todos os
        direitos reservados.
      </footer>
    </div>
  );
}
