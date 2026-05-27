import { CheckCircle2, Clock3, FileSignature } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { MemedStatusItem } from '@/types/memed';

interface MemedStatusPanelProps {
  items: MemedStatusItem[];
}

const iconByStatus = {
  connected: CheckCircle2,
  waiting: Clock3,
  generated: FileSignature,
};

const toneByStatus = {
  connected: 'bg-[#EAFBF1] text-[#0BA84F]',
  waiting: 'bg-[#FFF8E0] text-[#9A6A00]',
  generated: 'bg-[#EEF4FF] text-[#1557FF]',
};

export function MemedStatusPanel({ items }: MemedStatusPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div>
          <h2 className="text-base font-semibold text-[#1E1E1E]">Status Memed</h2>
          <p className="mt-1 text-sm text-[#5B6475]">Ambiente visual mockado, sem chamada real ao SDK</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => {
          const Icon = iconByStatus[item.status];

          return (
            <div key={item.id} className="flex items-start gap-3 rounded-lg border border-[#EEF2F7] bg-[#F8FAFC] p-4">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneByStatus[item.status]}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="font-semibold text-[#253044]">{item.label}</p>
                <p className="mt-1 text-sm text-[#5B6475]">{item.description}</p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
