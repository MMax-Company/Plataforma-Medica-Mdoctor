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
        <h2 className="text-base font-bold text-[#1E1E1E]">HISTÓRIA CLÍNICA</h2>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#9A6A00]" />
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
