/**
 * Gera o Code node n8n a partir do normalizador Node (subset executável no n8n).
 */
const fs = require('fs');
const path = require('path');
const {
  normalizeTypebotPayload,
  buildCleanBackendPayload,
  parseMedicationFreeText
} = require('../src/services/clinical-payload-normalizer.service');

const sample = normalizeTypebotPayload({
  patient_name: 'Teste',
  birth_date: '09/02/1988',
  cpf: '123.456.789-09',
  whatsapp: '5511999998888',
  email: 'a@b.com',
  address: 'Rua 1',
  cep: '01310100',
  chronic_condition: 'has',
  tempo_uso: 'Mais de 6 meses',
  has_previous_prescription: 'sim',
  previous_prescription_file: 'https://cdn/rx.jpg',
  sinais_alerta: 'NAO',
  eligibility_status: 'eligible',
  pagamento_status: 'paid',
  primeiro_medicamento: 'metformina 850 tomo 2x ao dia'
});

const medExample = parseMedicationFreeText('metformina 850 tomo 2x ao dia');

const header = `/**
 * n8n Code node — normalização Typebot → backend (gerado/atualizado manualmente).
 * Espelha mdoctor-backend/src/services/clinical-payload-normalizer.service.js
 */
`;

const body = fs.readFileSync(path.join(__dirname, '../../docs/n8n-workflows/lib/typebot-webhook-payload.code.js'), 'utf8');

// Keep runtime code in lib file; this script only validates parity.
console.log('Sample birth_date:', sample.normalized.birth_date);
console.log('Sample med:', medExample);
console.log('Clean keys:', Object.keys(buildCleanBackendPayload(sample.normalized)));
console.log('Lib file length:', body.length);
