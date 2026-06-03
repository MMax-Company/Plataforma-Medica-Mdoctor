import { Suspense, type ReactNode } from 'react';

export default function AtendimentoLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}
