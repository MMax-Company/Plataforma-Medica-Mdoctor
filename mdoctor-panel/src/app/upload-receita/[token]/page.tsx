'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);

export default function UploadReceitaPage() {
  const params = useParams();
  const token = String(params.token || '');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const uploadAction = useMemo(() => `${API_BASE}/api/upload-receita/${encodeURIComponent(token)}`, [token]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Selecione um arquivo JPG, PNG ou PDF (máx. 10 MB).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Arquivo excede 10 MB.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(uploadAction, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Falha no envio da receita.');
      }
      setSuccess(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar receita.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F4F7FC] px-4 py-10 text-[#080D33]">
      <div className="mx-auto max-w-lg rounded-xl border border-[#E5EAF2] bg-white p-6 shadow-[0_8px_24px_rgba(8,13,51,0.08)]">
        <p className="mb-2 inline-block rounded-full bg-[#EEF4FF] px-3 py-1 text-xs font-bold text-[#1557FF]">Doctor Prescreve</p>
        <h1 className="text-2xl font-black">Enviar foto da receita anterior</h1>
        <p className="mt-3 text-sm leading-6 text-[#26325F]">
          Para concluir sua solicitação, envie a foto ou PDF da sua receita anterior. Seu atendimento só será encaminhado
          para análise médica após o envio da imagem.
        </p>

        {success ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="text-base font-black">Receita enviada com sucesso</p>
            <p className="mt-2">Seu atendimento entrou na fila médica. Volte ao WhatsApp para acompanhar.</p>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="block text-sm font-bold" htmlFor="file">
              Arquivo (JPG, PNG ou PDF)
            </label>
            <input
              id="file"
              type="file"
              accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
              className="w-full rounded-lg border border-dashed border-[#B8C4D9] bg-[#FAFBFD] p-3 text-sm"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#1557FF] px-4 py-3 text-sm font-black text-white disabled:opacity-60"
            >
              {loading ? 'Enviando...' : 'Enviar foto da receita'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
