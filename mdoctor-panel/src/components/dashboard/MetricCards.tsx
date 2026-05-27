import { Activity, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { PanelMetric } from '@/types/panel';

const icons = {
  blue: Clock3,
  gold: Activity,
  green: CheckCircle2,
  danger: AlertTriangle,
};

const accents = {
  blue: 'bg-[#EEF4FF] text-[#1557FF]',
  gold: 'bg-[#FFF8E0] text-[#9A6A00]',
  green: 'bg-[#EAFBF1] text-[#0BA84F]',
  danger: 'bg-[#FFECEC] text-[#FF2D2D]',
};

interface MetricCardsProps {
  metrics: PanelMetric[];
}

export function MetricCards({ metrics }: MetricCardsProps) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => {
        const Icon = icons[metric.tone];

        return (
          <Card key={metric.id}>
            <CardContent className="flex items-center gap-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${accents[metric.tone]}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-semibold text-[#1E1E1E]">{metric.value}</p>
                <p className="text-sm font-semibold text-[#253044]">{metric.label}</p>
                <p className="truncate text-xs text-[#5B6475]">{metric.hint}</p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
