'use client';

/** Banner opcional de staging; rodapé de debug (commit/branch) removido do painel médico. */
const SHOW_TOP_BANNER = process.env.NEXT_PUBLIC_STAGING_BUILD_MARKER === 'true';

export function StagingBuildMarker() {
  if (!SHOW_TOP_BANNER) {
    return (
      <style jsx global>{`
        body.staging-audit-body {
          padding-bottom: 0 !important;
        }
      `}</style>
    );
  }

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        data-official-panel="v2"
        className="staging-audit-banner fixed left-0 right-0 top-0 z-[99999] border-b-2 border-[#7f1d1d] bg-[#dc2626] px-2 py-1.5 text-center text-[10px] font-bold tracking-wide text-white shadow-md sm:text-xs"
      >
        Staging — Doctor Prescreve
      </div>
      <div className="staging-audit-spacer h-7 shrink-0" aria-hidden />
      <style jsx global>{`
        body.staging-audit-body {
          background: linear-gradient(180deg, #fff7ed 0%, #f0f5ff 100px, #f8fafc 220px) !important;
          padding-bottom: 0 !important;
        }
      `}</style>
    </>
  );
}
