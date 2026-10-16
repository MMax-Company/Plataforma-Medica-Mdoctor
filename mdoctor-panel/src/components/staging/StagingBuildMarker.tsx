'use client';

/**
 * Marcador visual de staging removido da interface para não consumir altura
 * útil do painel. O ambiente continua sendo staging pela URL/configuração;
 * este componente apenas deixa de renderizar a faixa superior.
 */
export function StagingBuildMarker() {
  return (
    <style jsx global>{`
      body.staging-audit-body {
        padding-bottom: 0 !important;
      }
    `}</style>
  );
}
