/**
 * Probe staging deploy — terms_acceptance + support route (no secrets logged).
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const BACKEND = process.env.BACKEND_URL || 'https://mdoctor-backend-staging-staging.up.railway.app';
const SECRET = process.env.N8N_WEBHOOK_SECRET || '';

async function main() {
  const health = await fetch(`${BACKEND}/health`);
  const support = await fetch(`${BACKEND}/api/atendimentos/support-queue`);
  const phone = `5511977${String(Date.now()).slice(-6)}`;
  const body = {
    patient_name: 'Deploy Probe',
    whatsapp: phone,
    from: phone,
    cpf: '52998224725',
    birth_date: '09/02/1988',
    email: 'probe@test.com',
    address: 'Rua 1',
    cep: '01310100',
    chronic_condition: 'has',
    tempo_uso: 'Mais de 6 meses',
    has_previous_prescription: true,
    previous_prescription_file: 'https://example.com/rx.jpg',
    sinais_alerta: 'NAO',
    eligibility_status: 'eligible',
    payment_status: 'paid',
    lgpd_accepted: true,
    privacy_policy_accepted: true,
    telemedicine_consent_accepted: true,
    non_urgency_notice_accepted: true,
    terms_of_use_accepted: true,
    accepted_terms_at: new Date().toISOString(),
    typebot_public_id: 'doctor-prescreve-8rmljgu',
    med1_nome: 'losartana',
    med1_dose: '50mg',
    medication_count: 1
  };

  const webhook = await fetch(`${BACKEND}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': SECRET,
      'Idempotency-Key': `probe-${Date.now()}`
    },
    body: JSON.stringify({
      from: phone,
      text: 'probe',
      rawMessage: { provider: 'typebot', original: body }
    })
  });
  const data = await webhook.json();

  console.log(
    JSON.stringify(
      {
        health: health.status,
        supportQueueRoute: support.status,
        webhook: webhook.status,
        hasTermsAcceptance: Boolean(data?.atendimento?.dados_clinicos?.terms_acceptance),
        hasClinicalAuditTerms: Boolean(data?.atendimento?.dados_clinicos?.clinical_audit?.terms_presented),
        atendimentoStatus: data?.atendimento?.status,
        deploy6751Likely: Boolean(data?.atendimento?.dados_clinicos?.terms_acceptance)
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
