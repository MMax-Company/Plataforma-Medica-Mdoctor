/**
 * LEGADO — não usar em workflows ativos.
 * Normalizava Typebot → POST /api/whatsapp/webhook com payment_status=paid.
 * Oficial: lib/typebot-webhook-triagem.code.js → POST /api/webhook/triagem
 */
const input = $input.first().json || {};
const headers = input.headers || {};
const body = input.body || input;

const flowEnv = String($env.FLOW_ENV || 'staging').toLowerCase();
if (flowEnv !== 'staging') throw new Error('FLOW_ENV must be staging');

const PROTOCOL = 'staging-clinical-v1';
const INELIGIBLE_MSG =
  'Pelas informações fornecidas, não será possível seguir com a renovação por teleconsulta neste momento. Recomendamos atendimento médico presencial para melhor avaliação.';

function pick(...values) {
  for (const v of values) if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  return null;
}

function asBool(v) {
  const s = String(v || '').trim().toLowerCase();
  if (['sim', 'true', '1', 'yes', 's'].includes(s)) return true;
  if (['nao', 'não', 'false', '0', 'no', 'n'].includes(s)) return false;
  return null;
}

function digits(v, max) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return null;
  return max ? d.slice(0, max) : d;
}

function normalizeBirthDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d8 = raw.replace(/\D/g, '');
  if (d8.length === 8) return `${d8.slice(4, 8)}-${d8.slice(2, 4)}-${d8.slice(0, 2)}`;
  const m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null;
}

function normalizeCpf(v) {
  const d = digits(v, 11);
  return d && d.length === 11 ? d : null;
}

function normalizeWhatsapp(v) {
  const d = digits(v);
  if (!d) return null;
  if (d.length >= 12 && d.startsWith('55')) return `+${d}`;
  if (d.length >= 10) return `+55${d}`;
  return null;
}

function normalizeEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.includes('@') && e.includes('.') ? e : null;
}

function normalizeCep(v) {
  const d = digits(v, 8);
  return d && d.length === 8 ? d : null;
}

function normalizeCondition(v) {
  const t = String(v || '').toLowerCase();
  if (t.includes('hipert') || t === 'has') return 'hipertensao';
  if (t.includes('diabet') || t === 'dm' || t === 'dm2') return 'diabetes_tipo_2';
  if (t.includes('dislip') || t === 'dlp' || t.includes('colesterol')) return 'dislipidemia';
  if (t.includes('hipotire') || t.includes('tireoide')) return 'hipotireoidismo';
  return 'renovacao_receita';
}

function normalizePayment(v) {
  const s = String(pick(v.payment_status, v.pagamento_status, v.pagamento) || '').toLowerCase();
  const paid = ['paid', 'pago', 'confirmado', 'confirmed', 'success'].includes(s);
  return { payment_status: paid ? 'paid' : 'unpaid', pagamento_status: paid ? 'CONFIRMADO' : 'PENDENTE', paid };
}

function mapFrequency(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('12/12') || t.includes('2x') || t.includes('2 x')) return '12/12h';
  if (t.includes('8/8') || t.includes('3x') || t.includes('3 x')) return '8/8h';
  if (t.includes('1x') || t.includes('1 x') || t.includes('ao dia')) return '24h';
  return 'Conforme orientação médica';
}

function parseMedication(text, overrides = {}) {
  const raw = String(text || '').trim();
  if (!raw && !overrides.name) return null;
  const lower = `${raw} ${overrides.frequency || ''}`.toLowerCase();
  let name = overrides.name || '';
  let dose = overrides.dose || '';
  let unit = overrides.unit || 'mg';
  const dm = raw.match(/(\d+(?:[.,]\d+)?)\s*(mg|g|ml|mcg)?/i);
  if (dm) {
    dose = String(dose || dm[1]).replace(',', '.');
    unit = (dm[2] || unit).toLowerCase();
  }
  if (!name) {
    const nm = raw.match(/^([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\s-]+?)(?=\s+\d|\s*,|\s+tomo|$)/i);
    name = nm ? nm[1].trim() : raw.split(/[,\d]/)[0].trim();
  }
  name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  const frequency = overrides.frequency || mapFrequency(lower);
  const route = overrides.route || 'oral';
  const posology =
    frequency === '12/12h'
      ? `Tomar 1 comprimido por via oral a cada 12 horas${dose ? ` (${dose}${unit})` : ''}.`
      : `Tomar conforme prescrição anterior${dose ? ` — ${dose}${unit}` : ''}.`;
  return { name, dose, unit, route, frequency, posology, usage: 'contínuo', raw_text: raw };
}

function normalizeMedications(body, count) {
  const n = Math.min(3, Math.max(1, Number(count || 1)));
  const slots = [
    { text: pick(body.primeiro_medicamento, body.medication_name), o: { name: body.med1_nome, dose: body.med1_dose, frequency: body.med1_frequencia, route: body.med1_via } },
    { text: body.segundo_medicamento, o: { name: body.med2_nome, dose: body.med2_dose, frequency: body.med2_frequencia, route: body.med2_via } },
    { text: body.terceiro_medicamento, o: { name: body.med3_nome, dose: body.med3_dose, frequency: body.med3_frequencia, route: body.med3_via } }
  ];
  const meds = [];
  for (let i = 0; i < n; i++) {
    const parsed = parseMedication(slots[i].text, slots[i].o);
    if (parsed) meds.push({ index: i + 1, ...parsed });
  }
  return meds;
}

function mapWarningFlags(v) {
  const n = String(v || '').trim().toLowerCase();
  if (!n || n === 'nao' || n === 'não' || n.includes('nenhum')) return [];
  const flags = [];
  if (n.includes('dor no peito') || n.includes('falta de ar') || n.includes('desmaio')) flags.push('sinais_urgencia');
  if (n.includes('febre') || n.includes('sangramento')) flags.push('sinais_urgencia');
  if (!flags.length && n !== 'nao') flags.push('sinais_urgencia');
  return flags;
}

function usageDays(tempoUso) {
  const t = String(tempoUso || '').toLowerCase();
  if (t.includes('mais de 6')) return 180;
  if (t.includes('1 a 6') || t.includes('1-6')) return 60;
  if (t.includes('menos de 1')) return 15;
  return null;
}

const fromDigits = digits(body.from || body.whatsapp || body.telefone);
const whatsapp = normalizeWhatsapp(fromDigits);
if (!whatsapp) throw new Error('missing whatsapp/telefone');

const birthDate = normalizeBirthDate(pick(body.birth_date, body.data_nascimento));
const payment = normalizePayment(body);
const medications = normalizeMedications(body, body.medication_count);
const hasRx = asBool(body.has_previous_prescription) ?? asBool(body.receita_anterior);
const rxFile = pick(body.previous_prescription_file, body.foto_receita_url, body.fotoReceitaUrl);
const warningFlags = mapWarningFlags(body.sinais_alerta);
const hasWarning = asBool(body.has_warning_signs) === true || warningFlags.length > 0;
const days = usageDays(body.tempo_uso);
const chronic = normalizeCondition(pick(body.chronic_condition, body.doenca_cronica));

let eligibility_status = String(body.eligibility_status || '').toLowerCase() || 'eligible';
let ineligibility_reason = body.ineligibility_reason || null;
if (hasRx !== true) {
  eligibility_status = 'ineligible';
  ineligibility_reason = 'Ausência de comprovação de receita anterior.';
} else if (hasWarning) {
  eligibility_status = 'ineligible';
  ineligibility_reason = 'Sinais de alerta relatados.';
} else if (!payment.paid) {
  eligibility_status = 'ineligible';
  ineligibility_reason = 'Pagamento não confirmado.';
} else if (days !== null && days < 30) {
  eligibility_status = 'ineligible';
  ineligibility_reason = 'Tempo de uso insuficiente.';
} else if (chronic === 'renovacao_receita') {
  eligibility_status = 'ineligible';
  ineligibility_reason = 'Doença fora do protocolo.';
}

const correlationId = headers['x-correlation-id'] || headers['X-Correlation-Id'] || `typebot-${Date.now()}`;
const idempotencyKey = headers['idempotency-key'] || headers['Idempotency-Key'] || `${fromDigits}-${Date.now()}`;

const clean = {
  patient_name: pick(body.patient_name, body.nome, body.Nome_Completo),
  birth_date: birthDate,
  cpf: normalizeCpf(pick(body.cpf, body.cpf_paciente)),
  whatsapp,
  email: normalizeEmail(pick(body.email, body.Email)),
  address: pick(body.address, body.Endereco, body.endereco),
  cep: normalizeCep(pick(body.cep, body.CEP)),
  chronic_condition: chronic,
  medication_count: medications.length,
  medications,
  previous_prescription_file: rxFile || null,
  has_previous_prescription: hasRx === true,
  upload_url: pick(body.upload_url, body.uploadUrl) || null,
  has_warning_signs: hasWarning,
  eligibility_status,
  ineligibility_reason,
  payment_status: payment.payment_status,
  protocol: PROTOCOL,
  source: 'typebot',
  correlation_id: correlationId,
  queue_type: 'medical',
  continuous_use_days: days,
  lgpd_accepted: asBool(body.lgpd_accepted) === true,
  privacy_policy_accepted: asBool(body.privacy_policy_accepted) === true,
  telemedicine_consent_accepted: asBool(body.telemedicine_consent_accepted) === true,
  non_urgency_notice_accepted: asBool(body.non_urgency_notice_accepted) === true,
  terms_of_use_accepted: asBool(body.terms_of_use_accepted) === true,
  accepted_terms_at: pick(body.accepted_terms_at) || (asBool(body.terms_of_use_accepted) ? new Date().toISOString() : null),
  accepted_terms_links: body.accepted_terms_links || body.acceptedTermsLinks || [],
  terms_presented: body.terms_presented || body.termsPresented || null,
  terms_accepted: body.terms_accepted_summary || body.terms_accepted || null,
  typebot_public_id: pick(body.typebot_public_id, 'doctor-prescreve-8rmljgu')
};

const text =
  String(body.text || '').trim() ||
  `Triagem ${clean.patient_name || ''} | ${chronic} | ${medications[0]?.name || ''} | elegível: ${eligibility_status}`;

return [
  {
    json: {
      correlationId,
      idempotencyKey,
      payload: {
        from: fromDigits,
        text,
        rawMessage: {
          provider: 'typebot',
          messageId: idempotencyKey,
          timestamp: new Date().toISOString(),
          channel: 'whatsapp',
          source: flowEnv,
          original: {
            ...body,
            ...clean,
            pagamento_status: payment.pagamento_status,
            data_nascimento: birthDate,
            normalized_at: new Date().toISOString()
          }
        }
      },
      clean
    }
  }
];
