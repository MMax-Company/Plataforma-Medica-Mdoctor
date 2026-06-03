import type { ReactNode } from 'react';

export default function FilaLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fila-page-dense flex min-h-[calc(100dvh-2.75rem)] w-full justify-center bg-[#F6F9FD]">
      {children}
    </div>
  );
}
