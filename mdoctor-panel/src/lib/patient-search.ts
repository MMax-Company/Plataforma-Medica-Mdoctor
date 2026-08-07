/** Normalização e validação da busca de prontuário (somente painel). */

export function normalizeCpfDigits(value: string): string {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

export function formatCpfInput(value: string): string {
  const digits = normalizeCpfDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function normalizeSearchName(value: string): string {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function validateCpfSearch(cpf: string): string | null {
  const digits = normalizeCpfDigits(cpf);
  if (!digits) return 'Informe o CPF.';
  if (digits.length !== 11) return 'CPF deve conter 11 dígitos.';
  return null;
}

export function validateNameBirthSearch(name: string, birthDate: string): string | null {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Informe o nome do paciente.';
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return 'Informe pelo menos primeiro e segundo nome.';
  if (!String(birthDate || '').trim()) return 'Informe a data de nascimento.';
  return null;
}

export function buildSearchQuery(params: { cpf?: string; name?: string; birthDate?: string }): URLSearchParams {
  const q = new URLSearchParams();
  if (params.cpf) {
    q.set('cpf', normalizeCpfDigits(params.cpf));
  }
  if (params.name) {
    q.set('name', String(params.name).trim().replace(/\s+/g, ' '));
    if (params.birthDate) q.set('birth_date', params.birthDate);
  }
  // "Buscar Prontuário" é consulta arquivada — só atendimentos com decisão
  // médica real registrada (regra aplicada e validada no backend, ver
  // hasRegisteredMedicalDecision em atendimentos.routes.js).
  q.set('require_medical_decision', '1');
  return q;
}

/** Status que nunca deveriam aparecer aqui — proteção adicional no cliente,
 * não a barreira principal (essa é o filtro do backend via require_medical_decision). */
const NEVER_EVALUATED_STATUSES = new Set([
  'waiting',
  'queue',
  'fila',
  'triaged',
  'triagem',
  'aguardando_pagamento',
  'awaiting_prescription_upload',
  'aguardando_receita',
]);

export function isEvaluatedStatus(status: string): boolean {
  return !NEVER_EVALUATED_STATUSES.has(String(status || '').trim().toLowerCase());
}
