'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

/** Prontuário operacional unificado no painel — redireciona para /fila?atendimentoId= */
export default function AtendimentoRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const id = String(params?.id || '').trim();

  useEffect(() => {
    if (!id) {
      router.replace('/fila');
      return;
    }
    const query = new URLSearchParams(searchParams.toString());
    query.delete('atendimento');
    query.set('atendimentoId', id);
    router.replace(`/fila?${query.toString()}`);
  }, [id, router, searchParams]);

  return (
    <main className="flex min-h-[40vh] items-center justify-center bg-[#F6F9FD] text-sm text-[#5B6475]">
      Abrindo prontuário...
    </main>
  );
}
