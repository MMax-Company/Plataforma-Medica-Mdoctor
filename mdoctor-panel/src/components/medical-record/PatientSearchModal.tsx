'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { getApiBase } from '@/services/api';
import { authHeaders } from '@/services/auth.service';

type SearchResult = {
  id: string;
  paciente_nome: string;
  paciente_cpf: string;
  paciente_telefone: string;
  data_nascimento: string;
  criado_em: string;
  status: string;
  condicao: string;
};

const STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  queue: { label: 'Na fila', bg: 'bg-blue-100', text: 'text-blue-800' },
  fila: { label: 'Na fila', bg: 'bg-blue-100', text: 'text-blue-800' },
  waiting: { label: 'Aguardando', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  em_atendimento: { label: 'Em atendimento', bg: 'bg-green-100', text: 'text-green-800' },
  approved: { label: 'Aprovado', bg: 'bg-green-100', text: 'text-green-800' },
  ready: { label: 'Receita pronta', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  delivered: { label: 'Entregue', bg: 'bg-slate-100', text: 'text-slate-600' },
  rejected: { label: 'Recusado', bg: 'bg-red-100', text: 'text-red-700' },
  receita_emitida: { label: 'Receita emitida', bg: 'bg-teal-100', text: 'text-teal-800' },
  memed_processing: { label: 'Processando', bg: 'bg-purple-100', text: 'text-purple-800' },
};

function statusStyle(status: string) {
  const key = String(status || '').toLowerCase();
  return STATUS_MAP[key] ?? { label: key || 'Desconhecido', bg: 'bg-slate-100', text: 'text-slate-600' };
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDob(v: string): string {
  if (!v) return '—';
  // YYYY-MM-DD → DD/MM/YYYY
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v;
}

function maskCpf(v: string) {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11) return v || '—';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function maskPhone(v: string) {
  if (!v) return '—';
  const d = v.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return v;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200';

const sectionClass = 'rounded-xl border border-slate-100 bg-slate-50 p-3';

const btnSearch =
  'flex items-center gap-1.5 rounded-lg border border-blue-200 bg-[#1557FF] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 shrink-0';

const btnClear =
  'rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 shrink-0';

interface PatientSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelectAtendimento: (id: string) => void;
}

export function PatientSearchModal({ open, onClose, onSelectAtendimento }: PatientSearchModalProps) {
  const [mounted, setMounted] = useState(false);

  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const cpfRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    setTimeout(() => cpfRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  async function doSearch(params: Record<string, string>) {
    const nonEmpty = Object.fromEntries(Object.entries(params).filter(([, v]) => Boolean(v.trim())));
    if (Object.keys(nonEmpty).length === 0) return;
    const q = new URLSearchParams(nonEmpty);
    setLoading(true);
    setSearchError(null);
    setResults([]);
    setSearched(false);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/search?${q}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na busca');
      setResults(data.results ?? []);
      setSearched(true);
    } catch (e: unknown) {
      setSearchError(e instanceof Error ? e.message : 'Erro na busca');
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(id: string) {
    onClose();
    onSelectAtendimento(id);
  }

  function clearAll() {
    setCpf(''); setPhone(''); setName(''); setBirthDate('');
    setResults([]); setSearched(false); setSearchError(null);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex max-h-[88vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-black uppercase tracking-tight text-slate-900">Buscar Prontuário</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">Localize um paciente por CPF, telefone ou nome + data de nascimento</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:bg-slate-100"
            aria-label="Fechar busca"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search sections */}
        <div className="shrink-0 space-y-2 overflow-y-auto px-5 py-4">

          {/* CPF */}
          <div className={sectionClass}>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">1. Buscar por CPF</p>
            <div className="flex gap-2">
              <input
                ref={cpfRef}
                type="text"
                inputMode="numeric"
                className={inputClass}
                placeholder="000.000.000-00"
                value={cpf}
                maxLength={14}
                onChange={(e) => setCpf(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && cpf.trim()) void doSearch({ cpf }); }}
              />
              <button type="button" className={btnSearch} disabled={!cpf.trim() || loading} onClick={() => void doSearch({ cpf })}>
                <Search className="h-3 w-3" />
                Buscar
              </button>
            </div>
          </div>

          {/* Phone */}
          <div className={sectionClass}>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">2. Buscar por Telefone / WhatsApp</p>
            <div className="flex gap-2">
              <input
                type="tel"
                className={inputClass}
                placeholder="(11) 99999-9999 ou DDD + número"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && phone.trim()) void doSearch({ phone }); }}
              />
              <button type="button" className={btnSearch} disabled={!phone.trim() || loading} onClick={() => void doSearch({ phone })}>
                <Search className="h-3 w-3" />
                Buscar
              </button>
            </div>
          </div>

          {/* Name + DOB */}
          <div className={sectionClass}>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">3. Buscar por Nome + Data de Nascimento</p>
            <div className="flex gap-2">
              <input
                type="text"
                className={inputClass}
                placeholder="Nome completo do paciente"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && birthDate) void doSearch({ name, birth_date: birthDate }); }}
              />
              <input
                type="date"
                className={`${inputClass} w-40 shrink-0`}
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && birthDate) void doSearch({ name, birth_date: birthDate }); }}
              />
              <button
                type="button"
                className={btnSearch}
                disabled={!name.trim() || !birthDate || loading}
                onClick={() => void doSearch({ name, birth_date: birthDate })}
              >
                <Search className="h-3 w-3" />
                Buscar
              </button>
            </div>
          </div>

          {(searched || cpf || phone || name || birthDate) && (
            <div className="flex justify-end">
              <button type="button" className={btnClear} onClick={clearAll}>Limpar busca</button>
            </div>
          )}
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-slate-100">
          {loading && (
            <div className="flex items-center justify-center py-10 text-[12px] text-slate-400">
              Buscando...
            </div>
          )}

          {searchError && !loading && (
            <div className="px-5 py-4 text-[12px] text-red-700">
              {searchError}
            </div>
          )}

          {searched && !loading && !searchError && results.length === 0 && (
            <div className="px-5 py-10 text-center text-[12px] text-slate-400">
              Nenhum atendimento encontrado para os critérios informados.
            </div>
          )}

          {results.length > 0 && !loading && (
            <table className="w-full border-collapse text-[11px]">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {['Nome completo', 'CPF', 'Data de nasc.', 'Telefone', 'Último atend.', 'Status'].map((h) => (
                    <th key={h} className="border-b border-slate-100 px-3 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const s = statusStyle(r.status);
                  return (
                    <tr
                      key={r.id}
                      className={`cursor-pointer transition-colors hover:bg-blue-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}
                      onClick={() => handleSelect(r.id)}
                      title="Clique para abrir o prontuário"
                    >
                      <td className="px-3 py-2.5 font-semibold text-slate-900">{r.paciente_nome || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{r.paciente_cpf ? maskCpf(r.paciente_cpf) : '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600">{formatDob(r.data_nascimento)}</td>
                      <td className="px-3 py-2.5 text-slate-600">{maskPhone(r.paciente_telefone)}</td>
                      <td className="px-3 py-2.5 text-slate-500">{formatDate(r.criado_em)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${s.bg} ${s.text}`}>
                          {s.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {results.length > 0 && (
            <p className="px-5 py-2.5 text-[10px] text-slate-400">
              {results.length} resultado{results.length !== 1 ? 's' : ''} — clique em um paciente para abrir o prontuário
            </p>
          )}
        </div>

      </div>
    </div>,
    document.body
  );
}
