'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Fluxo oficial: login → /fila. Dashboard legado redireciona. */
export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/fila');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-[#5B6475]">
      Redirecionando para a fila...
    </main>
  );
}
