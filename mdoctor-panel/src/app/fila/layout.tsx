import { Suspense, type ReactNode } from 'react';

export default function FilaLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="fila-page-dense flex min-h-[calc(100dvh-1.5rem)] w-full items-center justify-center bg-[#F6F9FD] text-sm text-[#5B6475]">
          Carregando painel...
        </div>
      }
    >
      <div className="fila-page-dense flex min-h-[calc(100dvh-1.5rem)] w-full justify-center bg-[#F6F9FD]">
        {children}
      </div>
    </Suspense>
  );
}
