import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { MockPrescription } from '@/types/memed';

interface PrescriptionPreviewProps {
  prescription: MockPrescription;
  expanded?: boolean;
  simulated?: boolean;
}

export function PrescriptionPreview({ prescription, expanded = false, simulated = false }: PrescriptionPreviewProps) {
  return (
    <Card className={expanded ? 'border-[#1557FF]' : ''}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#1557FF]">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#1E1E1E]">Preview da receita</h2>
            <p className="text-sm text-[#5B6475]">Documento mockado para validação operacional</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={simulated ? 'gold' : 'green'}>{simulated ? 'Receita simulada' : 'Receita real'}</Badge>
          <Badge tone="blue">{prescription.id}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-[#E5EAF2] bg-[#FCFDFF] p-6">
          <div className="border-b border-[#E5EAF2] pb-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1557FF]">Doctor Prescreve</p>
            <h3 className="mt-2 text-xl font-semibold text-[#1E1E1E]">Receita Digital</h3>
            <p className="mt-1 text-sm text-[#5B6475]">Emitida por {prescription.issuedBy} em {prescription.createdAt}</p>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Paciente</p>
              <p className="mt-1 font-semibold text-[#253044]">{prescription.patient.name}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Medicamento</p>
              <p className="mt-1 font-semibold text-[#253044]">{prescription.medication}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Dose</p>
              <p className="mt-1 font-semibold text-[#253044]">{prescription.dosage}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Duração</p>
              <p className="mt-1 font-semibold text-[#253044]">{prescription.duration}</p>
            </div>
          </div>

          {expanded && (
            <div className="mt-5 rounded-md bg-white p-4 text-sm leading-6 text-[#253044]">
              <p className="font-semibold">Orientações</p>
              <p className="mt-2">{prescription.instructions}</p>
              <p className="mt-4 text-xs text-[#5B6475]">Assinatura digital e token Memed serão integrados na próxima etapa.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
