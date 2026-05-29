'use client';

import { useEffect, useMemo, useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/ui/Brand';
import { getAuthUser, type AuthUser } from '@/services/auth.service';

const DEFAULT_DOCTOR_NAME = 'Dr. Max Vinícius Matos';

function doctorInitials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'DR';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface MedicalPanelHeaderProps {
  onLogout: () => void;
  onOpenMedicalRecord?: () => void;
  compact?: boolean;
}

export function MedicalPanelHeader({ onLogout, onOpenMedicalRecord, compact = false }: MedicalPanelHeaderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getAuthUser());
  }, []);

  const doctorName = user?.name || DEFAULT_DOCTOR_NAME;
  const doctorRole = user?.role === 'admin' ? 'Administrador' : 'Médico';
  const initials = useMemo(() => doctorInitials(doctorName), [doctorName]);

  return (
    <header className="border-b border-[#E5EAF2] bg-white">
      <div className="mx-auto flex min-h-20 w-full max-w-[1680px] flex-wrap items-center justify-between gap-4 px-5 py-3 xl:px-7">
        <BrandLogo compact={compact} />

        <div className="flex flex-wrap items-center justify-end gap-3">
          {onOpenMedicalRecord ? (
            <Button variant="outline" className="hidden h-11 px-5 lg:inline-flex" onClick={onOpenMedicalRecord}>
              PRONTUÁRIO
            </Button>
          ) : null}
          <div className="hidden items-center gap-2 rounded-[14px] border border-[#D9E2F0] bg-white px-4 py-2 text-sm font-semibold text-[#253044] lg:flex">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#0BA84F]" aria-hidden="true" />
            Certificado digital conectado (Memed)
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1557FF] text-sm font-bold text-white">
              {initials}
            </div>
            <div className="hidden sm:block">
              <p className="text-sm font-bold text-[#1E1E1E]">{doctorName}</p>
              <p className="text-xs font-medium text-[#5B6475]">{doctorRole}</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="h-11 border-red-600 bg-red-600 px-4 text-white hover:bg-red-700 hover:text-white"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            SAIR
          </Button>
        </div>
      </div>
      <div className="h-1 w-full bg-[#F4B000]" aria-hidden="true" />
    </header>
  );
}
