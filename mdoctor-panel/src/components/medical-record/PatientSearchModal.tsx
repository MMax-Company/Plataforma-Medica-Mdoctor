'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { getApiBase } from '@/services/api';
import { authHeaders } from '@/services/auth.service';
import {
  buildSearchQuery,
  formatCpfInput,
  isEvaluatedStatus,
  validateCpfSearch,
  validateNameBirthSearch,
} from '@/lib/patient-search';

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
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v;
}

function maskCpf(v: string) {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11) return v || '—';
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200';

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
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');

  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const cpfRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    setTimeout(() => cpfRef.current?.focus(), 50);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  async function doSearch(mode: 'cpf' | 'name') {
    setSearchError(null);
    setResults([]);
    setSearched(false);

    if (mode === 'cpf') {
      const cpfError = validateCpfSearch(cpf);
      if (cpfError) {
        setSearchError(cpfError);
        return;
      }
    } else {
      const nameError = validateNameBirthSearch(name, birthDate);
      if (nameError) {
        setSearchError(nameError);
        return;
      }
    }

    const q =
      mode === 'cpf'
        ? buildSearchQuery({ cpf })
        : buildSearchQuery({ name, birthDate });

    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/atendimentos/search?${q}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na busca');
      // Proteção adicional no cliente — a barreira principal é o filtro do
      // backend (require_medical_decision=1 em buildSearchQuery).
      const evaluated = (data.results ?? []).filter((r: SearchResult) => isEvaluatedStatus(r.status));
      setResults(evaluated);
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
    setCpf('');
    setName('');
    setBirthDate('');
    setResults([]);
    setSearched(false);
    setSearchError(null);
  }

  const hasFilters = Boolean(cpf || name || birthDate);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-[2px] sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex h-[min(88vh,760px)] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">

        <div className="flex shrink-0 flex-col border-b border-slate-100">
          <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-[15px] font-black uppercase tracking-tight text-slate-900">Buscar Prontuário</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">Busque por CPF ou por nome + data de nascimento</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-400 hover:bg-slate-100"
              aria-label="Fechar busca"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 pb-3 sm:px-5">
            <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
              <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">CPF</p>
                <div className="flex min-w-0 gap-2">
                  <input
                    ref={cpfRef}
                    type="text"
                    inputMode="numeric"
                    className={inputClass}
                    placeholder="000.000.000-00"
                    value={cpf}
                    maxLength={14}
                    onChange={(e) => setCpf(formatCpfInput(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void doSearch('cpf');
                    }}
                  />
                  <button
                    type="button"
                    className={btnSearch}
                    disabled={!cpf.trim() || loading}
                    onClick={() => void doSearch('cpf')}
                  >
                    <Search className="h-3 w-3" />
                    Buscar
                  </button>
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  Nome + nascimento
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="Primeiro e segundo nome ou nome completo"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void doSearch('name');
                      }}
                    />
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <input
                      type="date"
                      className={`${inputClass} w-[108px] shrink-0`}
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void doSearch('name');
                      }}
                    />
                    <button
                      type="button"
                      className={btnSearch}
                      disabled={!name.trim() || !birthDate || loading}
                      onClick={() => void doSearch('name')}
                    >
                      <Search className="h-3 w-3" />
                      Buscar
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {(searched || hasFilters) && (
              <div className="mt-2 flex justify-end">
                <button type="button" className={btnClear} onClick={clearAll}>
                  Limpar busca
                </button>
              </div>
            )}

            {searchError && !loading ? (
              <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                {searchError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-slate-400">Buscando...</div>
          ) : null}

          {searched && !loading && !searchError && results.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-5 py-10 text-center text-[12px] text-slate-400">
              Nenhum atendimento encontrado para os critérios informados.
            </div>
          ) : null}

          {results.length > 0 && !loading ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[11px]">
                  <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_#e2e8f0]">
                    <tr>
                      {['Nome', 'CPF', 'Nascimento', 'Atendimento', 'Status'].map((h) => (
                        <th
                          key={h}
                          className="border-b border-slate-100 px-3 py-2 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400"
                        >
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
                          title="Clique para abrir o prontuário arquivado"
                        >
                          <td className="px-3 py-2.5 font-semibold text-slate-900">{r.paciente_nome || '—'}</td>
                          <td className="px-3 py-2.5 text-slate-600">{r.paciente_cpf ? maskCpf(r.paciente_cpf) : '—'}</td>
                          <td className="px-3 py-2.5 text-slate-600">{formatDob(r.data_nascimento)}</td>
                          <td className="px-3 py-2.5 text-slate-500">{formatDate(r.criado_em)}</td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${s.bg} ${s.text}`}
                            >
                              {s.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="shrink-0 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400 sm:px-5">
                {results.length} resultado{results.length !== 1 ? 's' : ''} — clique para consultar o prontuário arquivado
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
