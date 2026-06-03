'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/** Legado: emissão Memed real em /receita. */
export default function MemedRedirectPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '').trim();

  useEffect(() => {
    if (id) router.replace(`/receita?atendimentoId=${encodeURIComponent(id)}`);
    else router.replace('/fila');
  }, [id, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F8FAFC] text-sm text-[#5B6475]">
      Abrindo emissão de receita...
    </main>
  );
}
