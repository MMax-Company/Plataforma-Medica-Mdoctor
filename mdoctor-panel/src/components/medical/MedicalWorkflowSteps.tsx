'use client';

type Step = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
};

type MedicalWorkflowStepsProps = {
  steps: Step[];
};

export function MedicalWorkflowSteps({ steps }: MedicalWorkflowStepsProps) {
  return (
    <ol className="mb-4 flex flex-wrap gap-2">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${
            step.done
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : step.active
                ? 'border-[#1557FF] bg-[#EEF4FF] text-[#1557FF]'
                : 'border-[#E5EAF2] bg-white text-[#5B6475]'
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
              step.done ? 'bg-emerald-600 text-white' : step.active ? 'bg-[#1557FF] text-white' : 'bg-[#E5EAF2] text-[#5B6475]'
            }`}
          >
            {step.done ? '✓' : index + 1}
          </span>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
