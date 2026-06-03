#!/usr/bin/env node
/**
 * E2E upload externo: webhook sem arquivo → sessão → POST upload → fila médica.
 */
require('./load-dotenv');

const BACKEND = (process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '');
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';

function buildPayload(overrides = {}) {
  const phone = overrides.phone || `5511933${String(Date.now()).slice(-6)}`;
  return {
    patient_name: 'Upload Externo Test',
    whatsapp: phone,
    from: phone,
    cpf: '52998224725',
    birth_date: '09/02/1988',
    email: 'upload.externo@example.com',
    address: 'Rua Upload 1',
    cep: '01310100',
    chronic_condition: 'has',
    tempo_uso: 'Mais de 6 meses',
    has_previous_prescription: true,
    sinais_alerta: 'NAO',
    payment_status: 'paid',
    pagamento_status: 'CONFIRMADO',
    lgpd_accepted: true,
    privacy_policy_accepted: true,
    telemedicine_consent_accepted: true,
    non_urgency_notice_accepted: true,
    terms_of_use_accepted: true,
    med1_nome: 'losartana',
    med1_dose: '50mg',
    medication_count: 1,
    ...overrides
  };
}

async function main() {
  const ts = Date.now();
  const phone = `5511933${String(ts).slice(-6)}`;
  const payload = buildPayload({ whatsapp: phone, from: phone });

  const wh = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'Idempotency-Key': `ext-upload-${ts}`
    },
    body: JSON.stringify({
      from: phone,
      text: 'teste upload externo',
      rawMessage: { provider: 'typebot', original: payload }
    })
  });
  const whData = await wh.json();
  if (!wh.ok) throw new Error(`webhook failed: ${wh.status} ${JSON.stringify(whData)}`);
  if (whData.atendimento?.status !== 'awaiting_prescription_upload') {
    throw new Error(`expected awaiting_prescription_upload, got ${whData.atendimento?.status}`);
  }
  if (!whData.upload_url) throw new Error('upload_url missing in webhook response');

  const tokenMatch = String(whData.upload_url).match(/upload-receita\/([^/?#]+)/i);
  if (!tokenMatch) throw new Error('could not parse token from upload_url');
  const token = decodeURIComponent(tokenMatch[1]);

  const pdf = await fetch('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');
  const buffer = Buffer.from(await pdf.arrayBuffer());
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', buffer, { filename: 'receita.pdf', contentType: 'application/pdf' });

  const axios = require('axios');
  const up = await axios.post(`${BACKEND}/api/upload-receita/${encodeURIComponent(token)}`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    validateStatus: () => true
  });
  const upData = up.data || {};
  if (up.status < 200 || up.status >= 300 || !upData.success) {
    throw new Error(`upload failed: ${up.status} ${JSON.stringify(upData)}`);
  }
  if (upData.status !== 'waiting') throw new Error(`expected waiting after upload, got ${upData.status}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        atendimento_id: upData.atendimento_id,
        storage_path: upData.prescription?.storage_path,
        upload_url: whData.upload_url
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
