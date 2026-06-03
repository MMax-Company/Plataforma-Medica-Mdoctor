'use client';

/**
 * Marcador obrigatório de recuperação — staging Doctor Prescreve oficial.
 * Remover somente após sign-off visual do cliente.
 */
const COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT || 'local-dev';
const BRANCH = process.env.NEXT_PUBLIC_BUILD_BRANCH || 'unknown';
const BUILT_AT = process.env.NEXT_PUBLIC_BUILD_TIME || 'not-set';
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'not-set';
const SERVICE = process.env.NEXT_PUBLIC_RAILWAY_SERVICE || 'painel-medico-staging';
const PROJECT = process.env.NEXT_PUBLIC_RAILWAY_PROJECT || 'Painel-MDoctor';
const ENV = process.env.NEXT_PUBLIC_APP_ENV || 'staging';

export function StagingBuildMarker() {
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        data-official-panel="v2"
        className="staging-audit-banner fixed left-0 right-0 top-0 z-[99999] border-b-4 border-[#7f1d1d] bg-[#dc2626] px-3 py-2 text-center text-xs font-black tracking-wide text-white shadow-lg sm:text-sm"
      >
        PAINEL NOVO V2 — DOCTOR PRESCREVE OFICIAL
      </div>
      <div className="staging-audit-spacer h-10 shrink-0 sm:h-11" aria-hidden />
      <footer
        data-build-footer="official"
        className="staging-audit-footer fixed bottom-0 left-0 right-0 z-[99998] border-t-2 border-[#dc2626] bg-[#fff1f2] px-2 py-1.5 text-center font-mono text-[9px] leading-relaxed text-[#7f1d1d] sm:text-[10px]"
      >
        <div>
          commit {COMMIT} · branch {BRANCH} · build {BUILT_AT} · id {BUILD_ID}
        </div>
        <div>
          Railway {PROJECT} / {SERVICE} · env {ENV} · mdoctor-panel · Plataforma-Medica-Mdoctor
        </div>
      </footer>
      <style jsx global>{`
        body.staging-audit-body {
          background: linear-gradient(180deg, #fff7ed 0%, #f0f5ff 140px, #f8fafc 280px) !important;
          padding-bottom: 42px;
        }
      `}</style>
    </>
  );
}
