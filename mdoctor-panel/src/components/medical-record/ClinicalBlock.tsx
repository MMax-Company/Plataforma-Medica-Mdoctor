import { Activity, AlertCircle, ClipboardList, FileText, Pill, Stethoscope } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface ClinicalBlockProps {
  title: string;
  content: string;
}

export function ClinicalBlock({ title, content }: ClinicalBlockProps) {
  const iconByTitle: Record<string, JSX.Element> = {
    'Queixa Principal': <AlertCircle className="h-4 w-4" />,
    'Histórico Clínico': <ClipboardList className="h-4 w-4" />,
    'Exame Físico': <Stethoscope className="h-4 w-4" />,
    Alergias: <Activity className="h-4 w-4" />,
    'Medicações em Uso': <Pill className="h-4 w-4" />,
    'Conduta Médica': <FileText className="h-4 w-4" />,
  };

  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#1557FF]">
            {iconByTitle[title] || <FileText className="h-4 w-4" />}
          </span>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#1E1E1E]">{title}</p>
        </div>
        <p className="mt-3 text-sm leading-6 text-[#253044]">{content}</p>
      </CardContent>
    </Card>
  );
}
