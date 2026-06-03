'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import { getAuthUser, type AuthUser } from '@/services/auth.service';

const LOGO_SRC = '/doctor-prescreve-logo-transparent.png';
const LOGO_FALLBACK = '/doctor-prescreve-logo.png';

function doctorInitials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'MM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDoctorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Dr. Max Matos';
  if (/^dr\.?\s/i.test(trimmed)) return trimmed.replace(/^dr\.?\s*/i, 'Dr. ');
  return `Dr. ${trimmed}`;
}

interface ProntuarioMedicalHeaderProps {
  onLogout: () => void;
}

export function ProntuarioMedicalHeader({ onLogout }: ProntuarioMedicalHeaderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getAuthUser());
  }, []);

  const doctorName = formatDoctorName(user?.name || 'Max Matos');
  const doctorRole = user?.role === 'admin' ? 'Administrador' : 'Médico Cirurgião';
  const initials = useMemo(() => doctorInitials(doctorName), [doctorName]);

  return (
    <>
      <header className="prontuario-header">
        <div className="panel-shell prontuario-header__shell">
          <div className="prontuario-header__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOGO_SRC}
              alt="Doctor Prescreve"
              width={291}
              height={157}
              decoding="async"
              className="prontuario-header__logo"
              onError={(event) => {
                const img = event.currentTarget;
                if (img.src.includes('logo-transparent')) img.src = LOGO_FALLBACK;
              }}
            />
            <h1 className="prontuario-header__title">Painel Médico</h1>
          </div>

          <div className="prontuario-header__ops">
            <div className="prontuario-header__profile">
              <div className="prontuario-header__avatar">{initials}</div>
              <div className="prontuario-header__identity hidden min-w-0 sm:block">
                <p className="prontuario-header__name">{doctorName}</p>
                <p className="prontuario-header__role">{doctorRole}</p>
              </div>
              <ChevronDown className="prontuario-header__chevron hidden sm:block" aria-hidden="true" />
            </div>

            <span className="prontuario-header__divider hidden sm:block" aria-hidden="true" />

            <button type="button" onClick={onLogout} className="prontuario-header__logout">
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              SAIR
            </button>
          </div>
        </div>
      </header>
      <div className="panel-gold-band" aria-hidden="true" />
    </>
  );
}
