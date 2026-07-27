const {
  PROTOCOL_VERSION,
  normalizeCondition,
  normalizeBirthDate,
  extractUsageDays,
  hasPreviousPrescription,
  hasPrescriptionPhoto,
  hasControlledMedication,
  mapTypebotWarningFlags,
  parseClinicalFlags
} = require('./clinical-intelligence.service');
const {
  isInvalidClinicalValue,
  sanitizeMedications,
  normalizeStructuredAddress
} = require('./typebot-clinical-data.validation');

const INELIGIBLE_USER_MESSAGE =
  'Pelas informações fornecidas, não será possível seguir com a renovação por teleconsulta neste momento. Recomendamos atendimento médico presencial para melhor avaliação.';

const PAID_VALUES = new Set(['paid', 'pago', 'confirmado', 'confirmed', 'success', 'succeeded']);

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function asBool(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (['sim', 'true', '1', 'yes', 's'].includes(normalized)) return true;
  if (['nao', 'não', 'false', '0', 'no', 'n'].includes(normalized)) return false;
  return null;
}

// blk_receita_choice (Typebot) usa os values "available"/"none"/"send_later"
// para "Sim, possuo"/"Não possuo"/"Enviar depois" — asBool() genérico não
// reconhece esse vocabulário (só sim/não), então "available" nunca virava
// true e o atendimento era reprovado por "has_previous_prescription" mesmo
// quando o paciente respondia que possuía a receita. Reconhece "available"
// especificamente para este campo, sem alterar o comportamento de
// "none"/"send_later" (preservados como já eram).
function asPreviousPrescriptionBool(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'available') return true;
  if (normalized === 'none') return false;
  return asBool(value);
}

function normalizeDigits(value = '', maxLength = null) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (maxLength && digits.length > maxLength) return digits.slice(0, maxLength);
  return digits;
}

function normalizeCpf(value = '') {
  const digits = normalizeDigits(value, 11);
  if (!digits || digits.length !== 11) return null;
  return digits;
}

function normalizeWhatsapp(value = '') {
  let digits = normalizeDigits(value);
  if (!digits) return null;
  if (digits.length >= 12 && digits.startsWith('55')) return `+${digits}`;
  if (digits.length >= 10) return `+55${digits}`;
  return null;
}

function normalizeEmail(value = '') {
  const email = String(value || '').trim().toLowerCase();
  if (!email || !email.includes('@') || !email.includes('.')) return null;
  return email;
}

function normalizeCep(value = '') {
  const digits = normalizeDigits(value, 8);
  if (!digits || digits.length !== 8) return null;
  return digits;
}

function normalizeChronicCondition(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return {
    raw,
    normalized: normalizeCondition(raw)
  };
}

function parseJsonValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function normalizeConsentAcceptance(payload = {}) {
  const acceptedAt =
    pickFirst(payload.accepted_terms_at, payload.acceptedTermsAt) ||
    (asBool(payload.terms_of_use_accepted) === true ? new Date().toISOString() : null);

  const links =
    parseJsonValue(payload.accepted_terms_links) ||
    parseJsonValue(payload.acceptedTermsLinks) ||
    [];

  const presented = parseJsonValue(payload.terms_presented) || parseJsonValue(payload.termsPresented) || null;

  const termsAccepted = {
    lgpd: asBool(payload.lgpd_accepted) === true,
    privacy_policy: asBool(payload.privacy_policy_accepted) === true,
    telemedicine: asBool(payload.telemedicine_consent_accepted) === true,
    non_urgency: asBool(payload.non_urgency_notice_accepted) === true,
    terms_of_use: asBool(payload.terms_of_use_accepted) === true
  };

  const summary =
    parseJsonValue(payload.terms_accepted_summary) ||
    parseJsonValue(payload.terms_accepted) ||
    termsAccepted;

  return {
    lgpd_accepted: termsAccepted.lgpd,
    privacy_policy_accepted: termsAccepted.privacy_policy,
    telemedicine_consent_accepted: termsAccepted.telemedicine,
    non_urgency_notice_accepted: termsAccepted.non_urgency,
    terms_of_use_accepted: termsAccepted.terms_of_use,
    accepted_terms_at: acceptedAt,
    accepted_terms_links: Array.isArray(links) ? links : [],
    terms_presented: presented,
    terms_accepted: summary,
    typebot_public_id: pickFirst(payload.typebot_public_id, payload.typebotPublicId)
  };
}

function normalizePaymentStatus(payload = {}) {
  const raw = String(
    pickFirst(payload.payment_status, payload.pagamento_status, payload.pagamento, payload.paymentStatus) || ''
  )
    .trim()
    .toLowerCase();

  if (PAID_VALUES.has(raw) || raw === 'confimed') return { payment_status: 'paid', pagamento_status: 'CONFIRMADO', paid: true };
  return { payment_status: 'unpaid', pagamento_status: 'PENDENTE', paid: false };
}

function capitalizeMedicationName(name = '') {
  const cleaned = String(name || '').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function mapFrequency(text = '') {
  const t = String(text || '').toLowerCase();
  if (t.includes('12/12') || t.includes('2x') || t.includes('2 x') || t.includes('duas vezes')) return '12/12h';
  if (t.includes('8/8') || t.includes('3x') || t.includes('3 x') || t.includes('tres vezes') || t.includes('três vezes')) return '8/8h';
  if (t.includes('1x') || t.includes('1 x') || t.includes('uma vez') || t.includes('ao dia')) return '24h';
  if (t.includes('noite')) return '1x à noite';
  if (t.includes('manha') || t.includes('manhã')) return '1x pela manhã';
  return t || 'Conforme orientação médica';
}

function mapRoute(text = '') {
  const t = String(text || '').toLowerCase();
  if (t.includes('subling')) return 'sublingual';
  if (t.includes('subcut')) return 'subcutânea';
  if (t.includes('inal') || t.includes('spray')) return 'inalatória';
  if (t.includes('injet') || t.includes('sc') || t.includes('im')) return 'injetável';
  if (t.includes('topico') || t.includes('tópico') || t.includes('pomada')) return 'tópica';
  return 'oral';
}

// Palavra de dosagem na posologia: "comprimido" para vias orais/sublinguais
// (a grande maioria dos casos — renovação de receita por via oral), mantendo
// "unidade" só para injetável/subcutânea (ex.: insulina, onde "comprimido"
// não faz sentido clínico). Achado em homologação real (26/07): a palavra
// genérica "unidade" confundia a leitura da receita na farmácia.
function dosageUnitWord(route = '') {
  const r = String(route || '').toLowerCase();
  return r.includes('subcut') || r.includes('injet') ? 'unidade' : 'comprimido';
}

// Posologia compatível com a Memed a partir das opções fechadas do chatbot
// (1/2/3 vezes ao dia x via oral/sublingual/subcutânea). Nunca cai mais na
// frase genérica "Tomar conforme prescrição anterior" — casos não mapeados
// (ou legados) recebem a mesma redação de "uma vez ao dia".
function buildPosology({ frequency, route }) {
  const routeLabel = route === 'oral' || !route ? 'por via oral' : `por via ${route}`;
  const unit = dosageUnitWord(route);
  if (frequency === '12/12h') return `Tomar 1 ${unit} ${routeLabel}, a cada 12 horas.`;
  if (frequency === '8/8h') return `Tomar 1 ${unit} ${routeLabel}, a cada 8 horas.`;
  if (frequency === '1x à noite') return `Tomar 1 ${unit} ${routeLabel}, uma vez ao dia (à noite).`;
  if (frequency === '1x pela manhã') return `Tomar 1 ${unit} ${routeLabel}, uma vez ao dia (pela manhã).`;
  return `Tomar 1 ${unit} ${routeLabel}, uma vez ao dia.`;
}

function parseMedicationFreeText(text = '', overrides = {}) {
  const raw = String(text || '').trim();
  if (!raw && !overrides.name) return null;

  const combined = [raw, overrides.dose, overrides.frequency, overrides.route].filter(Boolean).join(' ');
  const lower = combined.toLowerCase();

  let name = overrides.name || '';
  let dose = overrides.dose || '';
  let unit = overrides.unit || 'mg';
  let frequency = overrides.frequency || '';
  let route = overrides.route || '';

  const doseSource = dose || raw;
  const doseMatch = String(doseSource).match(/(\d+(?:[.,]\d+)?)\s*(mg|g|ml|mcg|ui|%)?/i);
  if (doseMatch) {
    dose = String(doseMatch[1] || '').replace(',', '.');
    unit = (overrides.unit || doseMatch[2] || unit || 'mg').toLowerCase();
  }

  const rawDoseMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(mg|g|ml|mcg|ui|%)?/i);
  if (!dose && rawDoseMatch) {
    dose = String(rawDoseMatch[1] || '').replace(',', '.');
    unit = (overrides.unit || rawDoseMatch[2] || unit || 'mg').toLowerCase();
  }

  if (!name) {
    const nameMatch = raw.match(/^([a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ\s-]+?)(?=\s+\d|\s*,|\s+tomo|\s+uso|$)/i);
    name = nameMatch ? nameMatch[1].trim() : raw.split(/[,\d]/)[0].trim();
  }

  name = capitalizeMedicationName(name);
  // Normaliza sempre (mesmo quando vem de override estruturado med{n}_frequencia/med{n}_via)
  // — o texto bruto do botão do Typebot ("1x ao dia", "Via sublingual") precisa virar os
  // códigos que buildPosology() reconhece ('12/12h', 'sublingual' etc.), senão a posologia
  // nunca bate com a frequência/via realmente selecionada pelo paciente.
  frequency = mapFrequency(frequency || lower);
  route = mapRoute(route || lower);

  return {
    name,
    dose: dose || null,
    unit: unit || 'mg',
    route,
    frequency,
    posology: buildPosology({ frequency, route }),
    usage: 'contínuo',
    raw_text: raw || null,
    label: raw || `${name} ${dose || ''}${unit || ''}`.trim()
  };
}

function medicationHasStructuredFields(item = {}) {
  return Boolean(
    item?.name ||
      item?.dose ||
      item?.frequency ||
      item?.route ||
      item?.label ||
      item?.raw_text
  );
}

function normalizeMedicationBundle(payload = {}, maxItems = 3) {
  const declaredCount = Number(pickFirst(payload.medication_count, payload.qtd_medicamentos) || 0) || null;
  const slots = [
    {
      text: pickFirst(payload.primeiro_medicamento, payload.medication_name, payload.medicamento),
      overrides: {
        name: payload.med1_nome || payload.medication_1_name,
        dose: payload.med1_dose || payload.medication_1_dose,
        frequency: payload.med1_frequencia || payload.medication_1_frequency,
        route: payload.med1_via || payload.medication_1_route
      }
    },
    {
      text: payload.segundo_medicamento,
      overrides: {
        name: payload.med2_nome,
        dose: payload.med2_dose,
        frequency: payload.med2_frequencia,
        route: payload.med2_via
      }
    },
    {
      text: payload.terceiro_medicamento,
      overrides: {
        name: payload.med3_nome,
        dose: payload.med3_dose,
        frequency: payload.med3_frequencia,
        route: payload.med3_via
      }
    }
  ];

  let medications = [];

  if (Array.isArray(payload.medications) && payload.medications.length) {
    medications = payload.medications
      .slice(0, maxItems)
      .filter(medicationHasStructuredFields)
      .map((item) => {
        const parsed =
          parseMedicationFreeText(item.label || item.raw_text || item.name || '', {
            name: item.name,
            dose: item.dose,
            unit: item.unit,
            frequency: item.frequency,
            route: item.route
          }) || {};
        return {
          ...parsed,
          ...item,
          name: parsed.name || item.name,
          dose: parsed.dose || item.dose,
          frequency: parsed.frequency || item.frequency,
          route: parsed.route || item.route
        };
      });
  } else {
    const slotLimit = declaredCount
      ? Math.min(maxItems, Math.max(1, declaredCount))
      : maxItems;
    for (let i = 0; i < slotLimit; i += 1) {
      const slot = slots[i];
      if (!slot?.text && !slot?.overrides?.name) continue;
      const parsed = parseMedicationFreeText(slot.text || '', slot.overrides);
      if (parsed) medications.push(parsed);
    }
  }

  const sanitized = sanitizeMedications(medications, declaredCount);
  return {
    medications: sanitized.medications,
    medication_count: sanitized.medication_count,
    declared_medication_count: declaredCount,
    countMismatch: sanitized.countMismatch
  };
}

function normalizeWarningSigns(payload = {}) {
  const explicit = asBool(payload.has_warning_signs);
  const flags = mapTypebotWarningFlags(payload.sinais_alerta, payload.warning_signs);
  const hasWarning = explicit === true || flags.length > 0;
  return { has_warning_signs: hasWarning, warning_flags: flags };
}

function normalizeEligibilityStatus(payload = {}, validation = {}) {
  const explicit = String(payload.eligibility_status || payload.elegibilidade_status || '')
    .trim()
    .toLowerCase();
  if (explicit === 'ineligible' || explicit === 'inelegivel') {
    return { eligibility_status: 'ineligible', ineligibility_reason: payload.ineligibility_reason || validation.reason || INELIGIBLE_USER_MESSAGE };
  }
  if (!validation.ok) {
    return { eligibility_status: 'ineligible', ineligibility_reason: validation.reason || INELIGIBLE_USER_MESSAGE };
  }
  return { eligibility_status: 'eligible', ineligibility_reason: null };
}

function isExternalUploadMode() {
  return process.env.PRESCRIPTION_EXTERNAL_UPLOAD !== 'false';
}

function validateRequiredFields(normalized = {}, options = {}) {
  const externalUpload = options.externalUpload ?? isExternalUploadMode();
  const missing = [];
  if (!normalized.patient_name) missing.push('patient_name');
  if (!normalized.birth_date) missing.push('birth_date');
  if (!normalized.cpf) missing.push('cpf');
  if (!normalized.whatsapp) missing.push('whatsapp');
  if (!normalized.email) missing.push('email');
  if (!normalized.address) missing.push('address');
  if (!normalized.address_structured?.rua) missing.push('address.rua');
  if (!normalized.address_structured?.numero) missing.push('address.numero');
  if (!normalized.address_structured?.bairro) missing.push('address.bairro');
  if (!normalized.address_structured?.cidade) missing.push('address.cidade');
  if (!normalized.address_structured?.estado) missing.push('address.estado');
  if (!normalized.cep) missing.push('cep');
  if (!normalized.chronic_condition) missing.push('chronic_condition');
  if (!normalized.medications?.length) missing.push('medications');
  if (normalized.medications?.some((med) => isInvalidClinicalValue(med.dose) || isInvalidClinicalValue(med.name))) {
    missing.push('medications.invalid_values');
  }
  const declaredCount = Number(normalized.declared_medication_count || 0);
  if (declaredCount > 0 && declaredCount !== normalized.medication_count) {
    missing.push('medication_count.mismatch');
  }
  if (normalized.has_previous_prescription !== true) missing.push('has_previous_prescription');
  if (!externalUpload && !normalized.previous_prescription_file) missing.push('previous_prescription_file');
  if (normalized.lgpd_accepted !== true) missing.push('lgpd_accepted');
  if (normalized.privacy_policy_accepted !== true) missing.push('privacy_policy_accepted');
  if (normalized.telemedicine_consent_accepted !== true) missing.push('telemedicine_consent_accepted');
  if (normalized.non_urgency_notice_accepted !== true) missing.push('non_urgency_notice_accepted');
  if (normalized.terms_of_use_accepted !== true) missing.push('terms_of_use_accepted');

  if (missing.length) {
    return { ok: false, reason: `Dados obrigatórios incompletos: ${missing.join(', ')}`, missing };
  }
  return { ok: true };
}

function normalizeTypebotPayload(body = {}) {
  const original = body.rawMessage?.original && typeof body.rawMessage.original === 'object' ? body.rawMessage.original : body;

  const patientName = pickFirst(original.patient_name, original.nome, original.Nome_Completo, body.patient_name);
  const socialName = pickFirst(original.nome_social, original.social_name, body.nome_social, body.social_name);
  const birthDate = normalizeBirthDate(pickFirst(original.birth_date, original.data_nascimento, body.birth_date));
  const cpf = normalizeCpf(pickFirst(original.cpf, original.cpf_paciente, body.cpf));
  const whatsapp = normalizeWhatsapp(pickFirst(original.whatsapp, original.telefone, body.from, body.telefone));
  const email = normalizeEmail(pickFirst(original.email, original.Email, body.email));
  const addressStructured = normalizeStructuredAddress({
    ...original,
    address: pickFirst(original.address, original.Endereco, original.endereco, body.address),
    cep: pickFirst(original.cep, original.CEP, body.cep)
  });
  const address = addressStructured?.formatted || pickFirst(original.address, original.Endereco, original.endereco, body.address);
  const cep = normalizeCep(pickFirst(original.cep, original.CEP, body.cep, addressStructured?.cep));
  const chronic = normalizeChronicCondition(pickFirst(original.chronic_condition, original.doenca_cronica, body.doenca_cronica));
  const medicationBundle = normalizeMedicationBundle(original);
  const medications = medicationBundle.medications;
  const payment = normalizePaymentStatus(original);
  const usageDays = extractUsageDays({
    continuous_use_days: original.continuous_use_days,
    tempo_uso_dias: original.tempo_uso_dias,
    tempo_uso: original.tempo_uso
  });

  const hasPreviousRx =
    asPreviousPrescriptionBool(original.has_previous_prescription) ??
    asPreviousPrescriptionBool(original.receita_anterior) ??
    hasPreviousPrescription({ has_previous_prescription: original.has_previous_prescription, receita_anterior: original.receita_anterior });

  const prescriptionFile = pickFirst(
    original.previous_prescription_file,
    original.foto_receita_url,
    original.fotoReceitaUrl,
    original.prescription_photo_url
  );

  const warnings = normalizeWarningSigns(original);
  const controlled = hasControlledMedication(medications, medications[0]?.name);
  const consent = normalizeConsentAcceptance(original);

  const base = {
    patient_name: patientName,
    nome_social: socialName,
    social_name: socialName,
    birth_date: birthDate,
    cpf,
    whatsapp,
    email,
    address,
    address_structured: addressStructured
      ? {
          rua: addressStructured.rua,
          numero: addressStructured.numero,
          bairro: addressStructured.bairro,
          cidade: addressStructured.cidade,
          estado: addressStructured.estado
        }
      : null,
    cep,
    chronic_condition: chronic?.normalized || null,
    chronic_condition_label: chronic?.raw || null,
    medication_count: medicationBundle.medication_count,
    declared_medication_count: medicationBundle.declared_medication_count,
    medications,
    medication_name: medications[0]?.name || null,
    medication_dose: medications[0]?.dose || null,
    medication_unit: medications[0]?.unit || null,
    medication_route: medications[0]?.route || 'oral',
    medication_frequency: medications[0]?.frequency || null,
    posology: medications[0]?.posology || null,
    continuous_use_days: usageDays,
    tempo_uso: original.tempo_uso || null,
    has_previous_prescription: hasPreviousRx === true,
    previous_prescription_file: prescriptionFile,
    has_warning_signs: warnings.has_warning_signs,
    warning_flags: warnings.warning_flags,
    payment_status: payment.payment_status,
    pagamento_status: payment.pagamento_status,
    payment_confirmed: payment.paid,
    protocol: pickFirst(original.protocol, original.protocol_version, PROTOCOL_VERSION),
    source: pickFirst(original.source, 'typebot'),
    correlation_id: pickFirst(original.correlation_id, body.correlationId, body.correlation_id),
    queue_type: 'medical',
    ...consent
  };

  const externalUpload = isExternalUploadMode();
  const requiredCheck = validateRequiredFields(base, { externalUpload });
  // O normalizador não tem acesso à sessão do WhatsApp (fonte confiável do
  // pagamento) — só ao payload bruto do Typebot, que nunca preenche a
  // variável de pagamento nesta etapa. Por isso ele apenas normaliza
  // "awaiting_prescription_upload" pela prontidão clínica/documental, sem
  // decidir por pagamento; quem decide pagamento confirmado é
  // triagem-webhook.service.js, usando resolveConfirmedPaymentFromSession().
  const awaitingExternalUpload =
    externalUpload && hasPreviousRx === true && !prescriptionFile && requiredCheck.ok;
  const clinicalFlags = [
    ...warnings.warning_flags,
    ...parseClinicalFlags([original.text, original.sinais_alerta].filter(Boolean).join(' ')),
    ...(controlled ? ['contraindicacao_basica'] : []),
    ...(usageDays !== null && usageDays < 30 ? ['renovacao_insegura'] : []),
    ...(hasPreviousRx === false ? ['sem_comprovacao'] : []),
    ...(!externalUpload && !prescriptionFile ? ['sem_comprovacao'] : []),
    ...(awaitingExternalUpload ? ['aguardando_upload_receita'] : [])
  ];

  let validationReason = null;
  if (!requiredCheck.ok) validationReason = requiredCheck.reason;
  else if (warnings.has_warning_signs) validationReason = 'Sinais de alerta relatados na triagem';
  else if (controlled) validationReason = 'Medicamento controlado ou fora do protocolo';
  else if (usageDays !== null && usageDays < 30) validationReason = 'Tempo de uso insuficiente para renovação remota';
  else if (hasPreviousRx !== true) validationReason = 'Comprovação de receita anterior não confirmada';
  else if (!externalUpload && !prescriptionFile) validationReason = 'Receita anterior ou foto ausente';
  else if (!chronic?.normalized || chronic.normalized === 'renovacao_receita')
    validationReason = 'Doença crônica fora do protocolo permitido';

  const eligibility = normalizeEligibilityStatus(original, { ok: !validationReason, reason: validationReason });
  const canEnterMedicalQueue =
    eligibility.eligibility_status === 'eligible' &&
    payment.paid &&
    requiredCheck.ok &&
    Boolean(prescriptionFile) &&
    !awaitingExternalUpload;

  return {
    original,
    normalized: {
      ...base,
      eligibility_status: eligibility.eligibility_status,
      ineligibility_reason: eligibility.ineligibility_reason,
      flags: [...new Set(clinicalFlags)],
      validation: {
        required: requiredCheck,
        payment_confirmed: payment.paid,
        external_upload: externalUpload,
        awaiting_prescription_upload: awaitingExternalUpload,
        can_enter_medical_queue: canEnterMedicalQueue
      }
    }
  };
}

function toPatientEvaluationShape(normalized = {}) {
  return {
    name: normalized.patient_name,
    nome_social: normalized.nome_social,
    social_name: normalized.social_name,
    phone: normalized.whatsapp,
    email: normalized.email,
    cpf: normalized.cpf,
    address: normalized.address,
    address_structured: normalized.address_structured,
    cep: normalized.cep,
    birth_date: normalized.birth_date,
    data_nascimento: normalized.birth_date,
    condition: normalized.chronic_condition,
    doenca_cronica: normalized.chronic_condition_label,
    medicacao_em_uso: normalized.medication_name,
    medication: normalized.medication_name,
    medications: normalized.medications,
    medication_count: normalized.medication_count,
    tempo_uso_dias: normalized.continuous_use_days,
    tempo_uso: normalized.tempo_uso,
    continuous_use_proof: normalized.continuous_use_days !== null && normalized.continuous_use_days >= 30,
    previous_prescription: normalized.has_previous_prescription,
    receita_anterior: normalized.has_previous_prescription,
    previous_prescription_file: normalized.previous_prescription_file,
    foto_receita_url: normalized.previous_prescription_file,
    has_warning_signs: normalized.has_warning_signs,
    flags: normalized.flags,
    eligibility_status: normalized.eligibility_status,
    ineligibility_reason: normalized.ineligibility_reason,
    pagamento_status: normalized.pagamento_status,
    payment_status: normalized.payment_status,
    payment_confirmed: normalized.payment_confirmed,
    protocol_version: normalized.protocol,
    source: normalized.source,
    correlation_id: normalized.correlation_id,
    queue_type: 'medical',
    lgpd_accepted: normalized.lgpd_accepted,
    privacy_policy_accepted: normalized.privacy_policy_accepted,
    telemedicine_consent_accepted: normalized.telemedicine_consent_accepted,
    non_urgency_notice_accepted: normalized.non_urgency_notice_accepted,
    terms_of_use_accepted: normalized.terms_of_use_accepted,
    accepted_terms_at: normalized.accepted_terms_at,
    accepted_terms_links: normalized.accepted_terms_links,
    terms_presented: normalized.terms_presented,
    terms_accepted: normalized.terms_accepted,
    typebot_public_id: normalized.typebot_public_id,
    _forceIneligible: normalized.eligibility_status === 'ineligible',
    _ineligibilityReason: normalized.ineligibility_reason
  };
}

function buildCleanBackendPayload(normalized = {}, meta = {}) {
  return {
    patient_name: normalized.patient_name,
    nome_social: normalized.nome_social,
    social_name: normalized.social_name,
    birth_date: normalized.birth_date,
    cpf: normalized.cpf,
    whatsapp: normalized.whatsapp,
    email: normalized.email,
    address: normalized.address,
    address_structured: normalized.address_structured,
    cep: normalized.cep,
    chronic_condition: normalized.chronic_condition,
    medication_count: normalized.medication_count,
    medications: normalized.medications,
    previous_prescription_file: normalized.previous_prescription_file,
    has_previous_prescription: normalized.has_previous_prescription,
    has_warning_signs: normalized.has_warning_signs,
    eligibility_status: normalized.eligibility_status,
    ineligibility_reason: normalized.ineligibility_reason,
    payment_status: normalized.payment_status,
    protocol: normalized.protocol,
    source: normalized.source,
    correlation_id: meta.correlationId || normalized.correlation_id || null,
    queue_type: 'medical',
    continuous_use_days: normalized.continuous_use_days,
    lgpd_accepted: normalized.lgpd_accepted,
    privacy_policy_accepted: normalized.privacy_policy_accepted,
    telemedicine_consent_accepted: normalized.telemedicine_consent_accepted,
    non_urgency_notice_accepted: normalized.non_urgency_notice_accepted,
    terms_of_use_accepted: normalized.terms_of_use_accepted,
    accepted_terms_at: normalized.accepted_terms_at,
    accepted_terms_links: normalized.accepted_terms_links,
    terms_presented: normalized.terms_presented,
    terms_accepted: normalized.terms_accepted,
    typebot_public_id: normalized.typebot_public_id
  };
}

function hasStoredPreviousPrescription(clinical = {}) {
  const url = pickFirst(
    clinical.previous_prescription_url,
    clinical.foto_receita_url,
    clinical.previous_prescription_file,
    clinical.prescription_photo_url
  );
  const storagePath = clinical.previous_prescription_storage_path;
  return Boolean((url && String(url).length > 8) || (storagePath && String(storagePath).length > 3));
}

function isVisibleInMedicalPanel(atendimento = {}) {
  const clinical = atendimento.dados_clinicos || {};
  if (clinical.queue_type === 'support' || clinical.whatsapp_support === true) return false;
  if (atendimento.condicao === 'suporte_whatsapp') return false;

  const status = String(atendimento.status || '').toLowerCase();
  if (status === 'awaiting_prescription_upload' || clinical.prescription_upload_pending === true) return false;

  const paid = String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
  const eligible = atendimento.elegibilidade?.eligible === true;
  const rejected = status === 'rejected';
  const hasPhoto = hasStoredPreviousPrescription(clinical);

  return paid && eligible && !rejected && hasPhoto;
}

module.exports = {
  INELIGIBLE_USER_MESSAGE,
  normalizeTypebotPayload,
  toPatientEvaluationShape,
  buildCleanBackendPayload,
  hasStoredPreviousPrescription,
  isExternalUploadMode,
  isVisibleInMedicalPanel,
  parseMedicationFreeText,
  normalizeMedicationBundle,
  normalizeMedications: (payload, maxItems) => normalizeMedicationBundle(payload, maxItems).medications,
  normalizeBirthDate,
  normalizeCpf,
  normalizeWhatsapp,
  normalizePaymentStatus
};
