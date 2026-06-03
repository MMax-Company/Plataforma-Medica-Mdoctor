import { Activity, ClipboardList, FileText, MessageSquare, Pill, Shield, Stethoscope } from 'lucide-react';

interface ClinicalBlockProps {
  title: string;
  content: string;
  editable?: boolean;
  onContentChange?: (value: string) => void;
  className?: string;
}

const iconByTitle: Record<string, JSX.Element> = {
  'Queixa Principal': <MessageSquare className="h-4 w-4" />,
  'Histórico Clínico': <FileText className="h-4 w-4" />,
  'Exame Físico': <Stethoscope className="h-4 w-4" />,
  Alergias: <Shield className="h-4 w-4" />,
  'Medicações em Uso': <Pill className="h-4 w-4" />,
  'Conduta Médica': <ClipboardList className="h-4 w-4" />,
};

export function ClinicalBlock({ title, content, editable = false, onContentChange, className }: ClinicalBlockProps) {
  return (
    <article className={['prontuario-clinical-block', className].filter(Boolean).join(' ')}>
      <div className="prontuario-clinical-block__head">
        <span className="prontuario-clinical-block__icon">{iconByTitle[title] || <Activity className="h-4 w-4" />}</span>
        <p className="prontuario-clinical-block__title">{title.toUpperCase()}</p>
      </div>
      {editable ? (
        <textarea
          value={content}
          onChange={(event) => onContentChange?.(event.target.value)}
          className="prontuario-clinical-block__textarea"
        />
      ) : (
        <p className="prontuario-clinical-block__content">{content}</p>
      )}
    </article>
  );
}
