'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, LogOut } from 'lucide-react';
import { getAuthUser, type AuthUser } from '@/services/auth.service';

const LOGO_SRC = '/doctor-prescreve-logo-transparent.png';

function doctorInitials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDoctorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Dr. Max Matos';
  if (/^dr\.?\s/i.test(trimmed)) return trimmed.replace(/^dr\.?\s*/i, 'Dr. ');
  return `Dr. ${trimmed}`;
}

interface MedicalPanelHeaderProps {
  onLogout: () => void;
  onOpenMedicalRecord?: () => void;
  compact?: boolean;
}

export function MedicalPanelHeader({ onLogout, onOpenMedicalRecord }: MedicalPanelHeaderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getAuthUser());
  }, []);

  const doctorName = formatDoctorName(user?.name || 'Max Matos');
  const doctorRole = user?.role === 'admin' ? 'Administrador' : 'Médico';
  const initials = useMemo(() => doctorInitials(doctorName), [doctorName]);

  return (
    <>
    <header className="panel-header">
      <div className="panel-shell panel-header__shell">
        <div className="panel-header__col panel-header__col--brand">
          <div className="panel-header__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LOGO_SRC}
              alt="Doctor Prescreve"
              width={291}
              height={157}
              decoding="async"
              className="panel-header__logo shrink-0 bg-transparent"
              style={{ background: 'transparent' }}
            />
            <h1 className="panel-header__title">Painel Médico</h1>
          </div>
        </div>

        <div className="panel-header__col panel-header__col--center">
          {onOpenMedicalRecord ? (
            <button
              type="button"
              onClick={onOpenMedicalRecord}
              className="panel-header__prontuario dp-btn dp-btn-outline-soft shrink-0"
            >
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              PRONTUÁRIO
            </button>
          ) : null}
        </div>

        <div className="panel-header__col panel-header__col--ops">
          <div className="panel-header__ops">
            <div className="panel-header__memed">
              <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-[#0BA84F]" aria-hidden="true" />
              <span className="whitespace-nowrap">Certificado digital Memed</span>
            </div>

            <span className="panel-header__divider" aria-hidden="true" />

            <div className="panel-header__profile">
              <div className="panel-header__avatar">{initials}</div>
              <div className="hidden min-w-0 lg:block">
                <p className="panel-header__name">{doctorName}</p>
                <p className="panel-header__role">{doctorRole}</p>
              </div>
            </div>

            <span className="panel-header__divider" aria-hidden="true" />

            <button
              type="button"
              onClick={onLogout}
              className="panel-header__logout dp-btn dp-btn-red shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              SAIR
            </button>
          </div>
        </div>
      </div>
    </header>
    <div className="panel-gold-band" aria-hidden="true" />
    </>
  );
}
