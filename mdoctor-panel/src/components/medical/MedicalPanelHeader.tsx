'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClipboardList, LogOut } from 'lucide-react';
import { getAuthUser, type AuthUser } from '@/services/auth.service';
import { getMemedConfig } from '@/services/memed.service';

const LOGO_SRC = '/doctor-prescreve-logo-transparent.png';

type MemedStatus = 'connecting' | 'connected' | 'error';

const MEMED_STATUS_CONFIG: Record<MemedStatus, { color: string; label: string }> = {
  connected:  { color: '#0BA84F', label: 'Conectada' },
  connecting: { color: '#F59E0B', label: 'Conectando...' },
  error:      { color: '#EF4444', label: 'Desconectada' },
};

/**
 * Verifica conectividade real com o backend Memed.
 * isMemedRuntimeReady() reflete o SDK widget (só ativo durante consultas) — não serve
 * como indicador geral. getMemedConfig() testa se o backend responde corretamente.
 */
function useMemedStatus(): MemedStatus {
  const [status, setStatus] = useState<MemedStatus>('connecting');

  useEffect(() => {
    let cancelled = false;
    getMemedConfig()
      .then(() => { if (!cancelled) setStatus('connected'); })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  return status;
}

function doctorInitials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts.at(-1)![0]).toUpperCase();
}

function formatDoctorName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Dr. Max Matos';
  if (/^dr\.?\s/i.test(trimmed)) return trimmed.replace(/^dr\.?\s*/i, 'Dr. ');
  return `Dr. ${trimmed}`;
}

function displayName(name: string, role?: string): string {
  return role === 'administrativo' ? name.trim() || 'Administrador' : formatDoctorName(name);
}

function roleLabel(role?: string): string {
  if (role === 'administrativo') return 'Administrativo';
  return role === 'admin' ? 'Administrador' : 'Médico';
}

interface MedicalPanelHeaderProps {
  onLogout: () => void;
  onOpenMedicalRecord?: () => void;
  operational?: boolean;
  title?: string;
  /** Linha secundária opcional abaixo do título (ex.: contagem de
   * atendimentos, nome do paciente na Jornada). Não usada no Painel Médico. */
  subtitle?: string;
  titleAlign?: 'center' | 'left';
  recordButtonLabel?: string;
  recordButtonIcon?: ReactNode;
}

export function MedicalPanelHeader({
  onLogout,
  onOpenMedicalRecord,
  operational = false,
  title = 'Painel Médico',
  subtitle,
  titleAlign = 'center',
  recordButtonLabel = 'PRONTUÁRIO',
  recordButtonIcon = <ClipboardList className="h-4 w-4" aria-hidden="true" />,
}: Readonly<MedicalPanelHeaderProps>) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const memedStatus = useMemedStatus();

  useEffect(() => {
    setUser(getAuthUser());
  }, []);

  const doctorName = displayName(user?.name || 'Max Matos', user?.role);
  const doctorRole = roleLabel(user?.role);
  const initials = useMemo(() => doctorInitials(doctorName), [doctorName]);

  const memedCfg = MEMED_STATUS_CONFIG[memedStatus];

  return (
    <>
    <header className={`panel-header${operational ? ' panel-header--operational' : ''}`}>
      <div className="panel-shell panel-header__shell">

        {/* Esquerda — somente logo */}
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
          </div>
        </div>

        {/* Centro — título centralizado na página */}
        <div
          className={`panel-header__col panel-header__col--center${
            titleAlign === 'left' ? ' panel-header__col--title-left' : ''
          }`}
        >
          <div>
            <h1 className="panel-header__title">{title}</h1>
            {subtitle && (
              <p className="mt-0.5 whitespace-nowrap text-[11px] font-semibold leading-tight text-[#5B6475]">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Direita — PRONTUÁRIO isolado | gap | bloco ops (Memed · Perfil · SAIR) */}
        <div className="panel-header__col panel-header__col--ops">
          <div className="panel-header__right-group">

            {onOpenMedicalRecord ? (
              <button
                type="button"
                onClick={onOpenMedicalRecord}
                className="panel-header__prontuario dp-btn dp-btn-outline-soft shrink-0"
              >
                {recordButtonIcon}
                {recordButtonLabel}
              </button>
            ) : null}

            <div className="panel-header__ops">

              <div className="panel-header__memed">
                <span
                  className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: memedCfg.color }}
                  aria-hidden="true"
                />
                <span className="whitespace-nowrap">{memedCfg.label}</span>
              </div>

              <span className="panel-header__divider" aria-hidden="true" />

              <div className="panel-header__profile">
                <div className="panel-header__avatar">{initials}</div>
                <div className="panel-header__profile-text min-w-0">
                  <p className="panel-header__name truncate">{doctorName}</p>
                  <p className="panel-header__role truncate">{doctorRole}</p>
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

      </div>
    </header>
    <div className="panel-gold-band" aria-hidden="true" />
    </>
  );
}
