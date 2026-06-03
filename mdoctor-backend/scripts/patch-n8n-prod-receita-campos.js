#!/usr/bin/env node
/**
 * Patch mínimo no workflow produção (sem recriar):
 * - Normalizar Typebot: repassa previous_prescription_file e campos reorganizados
 * - Salvar Supabase: inclui foto_receita_url na triagem (coluna json/texto se existir)
 */
require('./load-dotenv');

const WORKFLOW_ID = process.env.N8N_PROD_WORKFLOW_ID || 'P7qhHC4iNgW8sxDJ';
const baseUrl = String(process.env.N8N_BASE_URL || 'https://n8n-node-production-f844.up.railway.app').replace(/\/$/, '');
const apiKey = String(process.env.N8N_API_KEY || '').trim();

const NORMALIZAR_CODE = `const raw = $input.first().json;
const dados = raw.body || raw.data || raw;

let telefone = String(dados.whatsapp || dados.telefone || dados.from || "").replace(/[^0-9]/g, "");
if (!telefone.startsWith("55")) telefone = "55" + telefone;

let dataNascimento = dados.data_nascimento || dados.birth_date || "";
if (dataNascimento && dataNascimento.includes("/")) {
  const p = dataNascimento.split("/");
  dataNascimento = \`\${p[2]}-\${p[1]}-\${p[0]}\`;
}

const sinais = String(dados.sinais_alerta || dados.has_warning_signs || "NAO").toUpperCase();
const hasRxFile = Boolean(
  dados.previous_prescription_file || dados.foto_receita_url || dados.fotoReceitaUrl
);
const hasRx = ["sim", "true", "1", "yes", "s"].includes(
  String(dados.has_previous_prescription || dados.receita_anterior || "").toLowerCase()
) || hasRxFile;
const paid = ["paid", "pago", "confirmado", "confirmed", "success"].includes(
  String(dados.payment_status || dados.pagamento_status || "").toLowerCase()
);

const doencas = dados.doenca_cronica || dados.chronic_condition ? [dados.doenca_cronica || dados.chronic_condition] : [];
const isElegivel =
  sinais === "NAO" &&
  doencas.length > 0 &&
  hasRx &&
  hasRxFile &&
  paid;

return [{
  json: {
    elegivel: isElegivel,
    nome: dados.Nome_Completo || dados.patient_name || dados.nome || "",
    cpf: dados.cpf_paciente || dados.cpf || "",
    telefone,
    email: dados.Email || dados.email || "",
    data_nascimento: dataNascimento,
    medicamento: dados.primeiro_medicamento || dados.medication_name || "",
    doenca: dados.doenca_cronica || dados.chronic_condition || "",
    previous_prescription_file: dados.previous_prescription_file || dados.foto_receita_url || "",
    foto_receita_url: dados.previous_prescription_file || dados.foto_receita_url || "",
    pagamento_confirmado: paid,
    raw_payload: dados
  }
}];`;

const SALVAR_BODY = `={
  "nome": "{{ $json.nome }}",
  "cpf": "{{ $json.cpf }}",
  "telefone": "{{ $json.telefone }}",
  "email": "{{ $json.email }}",
  "data_nascimento": "{{ $json.data_nascimento }}",
  "medicamento": "{{ $json.medicamento }}",
  "doenca": "{{ $json.doenca }}",
  "elegivel": {{ $json.elegivel }},
  "foto_receita_url": "{{ $json.foto_receita_url }}",
  "previous_prescription_file": "{{ $json.previous_prescription_file }}",
  "status": "pendente",
  "created_at": "{{ new Date().toISOString() }}"
}`;

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-N8N-API-KEY': apiKey },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (!apiKey) {
    console.error('N8N_API_KEY required');
    process.exit(1);
  }
  const wf = await api('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  const nodes = wf.nodes || [];
  let changed = 0;
  for (const node of nodes) {
    if (node.name === 'Normalizar Typebot') {
      node.parameters = node.parameters || {};
      node.parameters.jsCode = NORMALIZAR_CODE;
      changed += 1;
    }
    if (node.name === 'Salvar Supabase') {
      node.parameters = node.parameters || {};
      node.parameters.jsonBody = SALVAR_BODY;
      changed += 1;
    }
  }
  if (!changed) throw new Error('Nodes alvo não encontrados no workflow');
  await api('PATCH', `/api/v1/workflows/${WORKFLOW_ID}`, {
    name: wf.name,
    nodes,
    connections: wf.connections,
    settings: wf.settings
  });
  console.log(JSON.stringify({ ok: true, workflowId: WORKFLOW_ID, nodesPatched: changed }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
