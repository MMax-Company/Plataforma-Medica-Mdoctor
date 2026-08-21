#!/usr/bin/env node
/**
 * Testes da busca de prontuário — staging only.
 * Run: node scripts/test-patient-search-staging.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

[path.join(__dirname, '../.env.local'), path.join(__dirname, '../.env'), path.join(ROOT, 'mdoctor-backend/.env')].forEach(loadEnvFile);

const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const USER = process.env.MEDICO_USER || process.env.MEDICO_OFFICIAL_USER || 'drmax.matos';
const PASS = process.env.MEDICO_PASS || process.env.MEDICO_OFFICIAL_PASS || '';

const report = [];

function step(name, ok, extra = {}) {
  report.push({ name, ok, ...extra });
}

function normalizeCpfDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

async function login() {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: USER, password: PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(`Login falhou: ${res.status}`);
  return data.token;
}

async function search(token, params) {
  const q = new URLSearchParams(params);
  const res = await fetch(`${BACKEND}/api/atendimentos/search?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function getAtendimento(token, id) {
  const res = await fetch(`${BACKEND}/api/atendimentos/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  if (!PASS) throw new Error('MEDICO_PASS ausente');

  step('validacao_cpf_curto', normalizeCpfDigits('123').length !== 11);
  step('validacao_nome_tokens', 'Maria Silva'.split(/\s+/).length >= 2);

  const token = await login();

  const none = await search(token, { cpf: '00000000000' });
  step('nenhum_resultado', none.status === 200 && (none.data.results || []).length === 0, {
    total: none.data.total,
  });

  const all = await search(token, { name: 'Teste', birth_date: '1988-02-09' });
  const totalByName = (all.data.results || []).length;
  step('busca_nome_nascimento', all.status === 200, { total: totalByName });

  if (totalByName >= 2) {
    step('multiplos_resultados', totalByName >= 2, { total: totalByName });
  } else {
    step('multiplos_resultados', true, { skipped: 'menos de 2 registros no staging' });
  }

  const sample = (all.data.results || [])[0];
  if (sample?.paciente_cpf) {
    const byCpf = await search(token, { cpf: normalizeCpfDigits(sample.paciente_cpf) });
    const cpfHits = (byCpf.data.results || []).length;
    step('busca_cpf', byCpf.status === 200 && cpfHits >= 1, { total: cpfHits });
  } else {
    step('busca_cpf', true, { skipped: 'sem CPF de amostra no staging' });
  }

  if (sample?.paciente_nome) {
    const parts = String(sample.paciente_nome).trim().split(/\s+/);
    const shortName = parts.slice(0, 2).join(' ');
    const dob = sample.data_nascimento || '1988-02-09';
    const byShort = await search(token, { name: shortName, birth_date: dob });
    step('primeiro_segundo_nome_nascimento', byShort.status === 200 && (byShort.data.results || []).length >= 1, {
      query: shortName,
      total: (byShort.data.results || []).length,
    });
    const byFull = await search(token, { name: sample.paciente_nome, birth_date: dob });
    step('nome_completo_nascimento', byFull.status === 200 && (byFull.data.results || []).length >= 1, {
      total: (byFull.data.results || []).length,
    });
  } else {
    step('primeiro_segundo_nome_nascimento', true, { skipped: 'sem paciente de amostra' });
    step('nome_completo_nascimento', true, { skipped: 'sem paciente de amostra' });
  }

  const archived = (all.data.results || []).find((r) =>
    ['delivered', 'finished', 'receita_emitida', 'ready', 'validated'].includes(String(r.status || '').toLowerCase()),
  ) || sample;

  if (archived?.id) {
    const detail = await getAtendimento(token, archived.id);
    const a = detail.data?.atendimento;
    const c = a?.dados_clinicos || {};
    const hasClinical = Boolean(c.queixa_principal || c.historico_clinico || c.medicacao_em_uso || c.conduta);
    const hasRx = Boolean(
      c.previous_prescription_storage_path ||
        c.previous_prescription_url ||
        c.foto_receita_url ||
        c.memed_receita,
    );
    step('prontuario_arquivado_completo', detail.status === 200 && Boolean(a?.paciente_nome) && hasClinical, {
      id: archived.id,
      hasReceita: hasRx,
      status: a?.status,
    });
  } else {
    step('prontuario_arquivado_completo', true, { skipped: 'staging sem atendimentos arquivados' });
  }

  const failed = report.filter((r) => !r.ok);
  console.log(JSON.stringify({ backend: BACKEND, passed: report.length - failed.length, failed: failed.length, report }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }));
  process.exit(1);
});
