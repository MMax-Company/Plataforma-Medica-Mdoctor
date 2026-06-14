'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type ContingencyFormData = {
  medications: string;
  orientations: string;
};

interface ContingencyPrescriptionModalProps {
  open: boolean;
  patientName: string;
  patientCpf?: string;
  condition?: string;
  loading?: boolean;
  onConfirm: (data: ContingencyFormData) => void;
  onClose: () => void;
}

function maskCpf(v = '') {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11) return v || '—';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function todayBR() {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const textareaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 resize-none';

export function ContingencyPrescriptionModal({
  open,
  patientName,
  patientCpf,
  condition,
  loading = false,
  onConfirm,
  onClose
}: ContingencyPrescriptionModalProps) {
  const [mounted, setMounted] = useState(false);
  const [medications, setMedications] = useState('');
  const [orientations, setOrientations] = useState('');
  const medRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    setTimeout(() => medRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  function handleConfirm() {
    if (!medications.trim()) return;
    onConfirm({ medications: medications.trim(), orientations: orientations.trim() });
  }

  const previewText = [
    `*Receita Médica — Doctor Prescreve*`,
    `Data: ${todayBR()}`,
    ``,
    `Paciente: ${patientName}`,
    patientCpf ? `CPF: ${maskCpf(patientCpf)}` : '',
    condition ? `Condição: ${condition}` : '',
    ``,
    `*Medicações:*`,
    medications.trim() || '(preencha o campo acima)',
    ``,
    `*Orientações:*`,
    orientations.trim() || '(preencha o campo acima)',
    ``,
    `— Doctor Prescreve`
  ].filter(Boolean).join('\n');

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[90vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-amber-100 bg-amber-50 px-5 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-800">Contingência</span>
              <h2 className="text-[14px] font-black uppercase tracking-tight text-slate-900">Receita de Contingência</h2>
            </div>
            <p className="mt-0.5 text-[10px] text-amber-700">Uso temporário enquanto a Memed está em manutenção — sem certificado digital</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:bg-slate-100" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: form */}
          <div className="flex flex-col gap-3 overflow-y-auto border-r border-slate-100 p-4 w-[55%] shrink-0">

            {/* Patient info (read-only) */}
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Paciente</p>
              <p className="text-[12px] font-bold text-slate-800">{patientName}</p>
              {patientCpf && <p className="text-[11px] text-slate-500">CPF: {maskCpf(patientCpf)}</p>}
              {condition && <p className="text-[11px] text-slate-500">Condição: {condition}</p>}
              <p className="text-[11px] text-slate-400">Data: {todayBR()}</p>
            </div>

            {/* Medications */}
            <div>
              <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">
                Medicações <span className="text-red-500">*</span>
              </label>
              <textarea
                ref={medRef}
                className={textareaClass}
                rows={5}
                placeholder="Ex: Metformina 500mg — 1 comprimido 2x ao dia por 30 dias"
                value={medications}
                onChange={(e) => setMedications(e.target.value)}
              />
            </div>

            {/* Orientations */}
            <div>
              <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Orientações</label>
              <textarea
                className={textareaClass}
                rows={3}
                placeholder="Ex: Tomar com alimento. Retornar em 30 dias."
                value={orientations}
                onChange={(e) => setOrientations(e.target.value)}
              />
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex flex-1 flex-col overflow-y-auto p-4">
            <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">Prévia — mensagem WhatsApp</p>
            <pre className="flex-1 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">
              {previewText}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-5 py-3.5">
          <p className="text-[10px] text-slate-400">A mensagem acima será enviada ao paciente via WhatsApp</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!medications.trim() || loading}
              className="rounded-lg bg-[#1557FF] px-4 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Confirmar e Enviar via WhatsApp'}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  );
}
