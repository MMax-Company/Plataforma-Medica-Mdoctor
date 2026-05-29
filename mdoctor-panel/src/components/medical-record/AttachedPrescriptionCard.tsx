'use client';

import { ExternalLink, FileImage } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface AttachedPrescriptionCardProps {
  imageUrl: string | null;
}

export function AttachedPrescriptionCard({ imageUrl }: AttachedPrescriptionCardProps) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-bold text-[#1E1E1E]">RECEITA ANEXADA</h2>
      </CardHeader>
      <CardContent className="space-y-3">
        {imageUrl ? (
          <>
            <div className="overflow-hidden rounded-xl border border-[#E5EAF2] bg-[#F8FAFC]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Receita anterior enviada pelo paciente" className="max-h-64 w-full object-contain" />
            </div>
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[14px] border border-[#C8D3E2] bg-white px-4 text-sm font-semibold text-[#253044] transition-colors hover:bg-[#F8FAFC]"
            >
              <FileImage className="h-4 w-4" aria-hidden="true" />
              Visualizar imagem
              <ExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
            </a>
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-[#D9E2F0] bg-[#F8FAFC] px-4 py-6 text-center text-sm text-[#5B6475]">
            Nenhuma imagem de receita anexada neste atendimento.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
