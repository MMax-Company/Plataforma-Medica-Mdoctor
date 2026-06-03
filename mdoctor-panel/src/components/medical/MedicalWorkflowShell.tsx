'use client';

import type { ReactNode } from 'react';
import { MedicalPanelHeader } from '@/components/medical/MedicalPanelHeader';
import { logout } from '@/services/auth.service';

type MedicalWorkflowShellProps = {
  children: ReactNode;
  sidebar?: ReactNode;
  actionRail?: ReactNode;
  breadcrumb?: ReactNode;
  title: string;
  subtitle?: string;
  onOpenQueue?: () => void;
};

export function MedicalWorkflowShell({
  children,
  sidebar,
  actionRail,
  breadcrumb,
  title,
  subtitle,
  onOpenQueue,
}: MedicalWorkflowShellProps) {
  async function handleLogout() {
    await logout();
    window.location.href = '/login';
  }

  return (
    <main className="medical-workflow-root min-h-screen bg-[#F6F9FD] text-[#071B3A]">
      <MedicalPanelHeader
        compact
        onLogout={handleLogout}
        onOpenMedicalRecord={onOpenQueue}
      />

      <div className="medical-workflow-body mx-auto w-full max-w-panel px-3 pb-28 pt-2 sm:px-4">
        {breadcrumb}

        <header className="mb-4">
          <h1 className="text-panel-xl font-bold tracking-tight text-[#080D33]">{title}</h1>
          {subtitle ? <p className="mt-1 text-panel-sm text-[#5B6475]">{subtitle}</p> : null}
        </header>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(260px,300px)_minmax(0,1fr)]">
          {sidebar ? <aside className="min-w-0 space-y-3">{sidebar}</aside> : null}
          <section className="min-w-0">{children}</section>
        </div>
      </div>

      {actionRail}
    </main>
  );
}
