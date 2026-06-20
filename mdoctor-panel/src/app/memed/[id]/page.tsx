'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Rota legada desativada — redireciona para /fila. Emissão Memed só via fluxo oficial de aprovação. */
export default function MemedRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/fila');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-[#5B6475]">
      Redirecionando…
    </main>
  );
}
