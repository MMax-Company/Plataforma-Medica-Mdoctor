import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { MedicalRecord } from '@/types/medical-record';

interface MedicalHistoryCardProps {
  record: MedicalRecord;
}

const riskTone = {
  low: 'green',
  medium: 'gold',
  high: 'danger',
} as const;

export function MedicalHistoryCard({ record }: MedicalHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFF8E0] text-[#9A6A00]">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#1E1E1E]">História clínica</h2>
            <p className="text-sm text-[#5B6475]">Resumo capturado na triagem</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone={riskTone[record.medicalHistory.risk]}>Risco {record.medicalHistory.risk}</Badge>
          <Badge>Chatbot {record.medicalHistory.chatbotCompletedAt}</Badge>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Condições prévias</p>
          <ul className="mt-2 space-y-2 text-sm text-[#253044]">
            {record.medicalHistory.previousConditions.map((condition) => (
              <li key={condition} className="rounded-md bg-[#F8FAFC] px-3 py-2">
                {condition}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8A94A6]">Receitas anteriores</p>
          <ul className="mt-2 space-y-2 text-sm text-[#253044]">
            {record.medicalHistory.previousPrescriptions.map((prescription) => (
              <li key={prescription} className="rounded-md bg-[#F8FAFC] px-3 py-2">
                {prescription}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
