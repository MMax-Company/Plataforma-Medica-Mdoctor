import { Card, CardContent } from '@/components/ui/card';

interface ClinicalBlockProps {
  title: string;
  content: string;
}

export function ClinicalBlock({ title, content }: ClinicalBlockProps) {
  return (
    <Card>
      <CardContent>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#1557FF]">{title}</p>
        <p className="mt-3 text-sm leading-6 text-[#253044]">{content}</p>
      </CardContent>
    </Card>
  );
}
