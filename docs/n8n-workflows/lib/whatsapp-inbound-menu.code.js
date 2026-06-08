/**
 * Source for n8n Code node "Handle WhatsApp Inbound Menu" (Evolution webhook).
 * Sync into evolution-webhook-staging.json when editing menu logic.
 */
const input = $input.first().json || {};
const ctx = input;
const staticData = $getWorkflowStaticData('global');
if (!staticData.sessions) staticData.sessions = {};

const flowEnv = String($env.FLOW_ENV || 'staging').toLowerCase();
if (flowEnv !== 'staging') throw new Error('FLOW_ENV must be staging');

const evoUrl = String($env.EVOLUTION_API_URL || $env.RAILWAY_SERVICE_EVOLUTION_API_STAGING_URL || '')
  .replace(/\/$/, '')
  .replace(/\.railway\.internal.*/, '.up.railway.app');
const evoKey = String($env.EVOLUTION_API_KEY || $env.AUTHENTICATION_API_KEY || '').trim();
const instance = String($env.EVOLUTION_INSTANCE || 'mdoctor-staging').trim();
const backendUrl = String($env.BACKEND_URL_STAGING || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(
  /\/$/,
  ''
);
const n8nSecret = String($env.N8N_WEBHOOK_SECRET || '').trim();
const typebotPublicId = String($env.TYPEBOT_PUBLIC_ID || 'doctor-prescreve-8rmljgu').trim();
const typebotUrl = String($env.TYPEBOT_PUBLIC_URL || `https://typebot.co/${typebotPublicId}`).trim();
const n8nTypebotWebhook = String(
  $env.N8N_TYPEBOT_WEBHOOK_URL || 'https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook'
).trim();

function normalizePhone(jid) {
  return String(jid || '')
    .replace(/\D/g, '')
    .replace(/@.*/, '');
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const phone = normalizePhone(ctx.remoteJid);
const rawText = String(ctx.text || '').trim();
const text = normalizeText(rawText);
const correlationId = ctx.correlationId || `evo-menu-${Date.now()}`;
const idempotencyKey = ctx.idempotencyKey || ctx.messageId || `${phone}-${Date.now()}`;

const MENU_TEXT = [
  '*Doctor Prescreve*',
  '',
  'Como podemos ajudar?',
  '',
  '*1* - ATENDIMENTO MÉDICO ONLINE',
  '*2* - FALAR COM EQUIPE / SUPORTE',
  '',
  'Responda com o número da opção.'
].join('\n');

const SUPPORT_WAIT_TEXT = [
  'Aguarde, em breve nossa equipe realizará seu atendimento.',
  '',
  '*0* - Voltar ao menu inicial',
  '*ENCERRAR* - Encerrar atendimento'
].join('\n');

async function sendWhatsAppText(message) {
  if (!evoUrl || !evoKey || !instance || !phone) return { skipped: true, reason: 'evolution_not_configured' };
  return this.helpers.httpRequest({
    method: 'POST',
    url: `${evoUrl}/message/sendText/${instance}`,
    headers: { apikey: evoKey, 'Content-Type': 'application/json' },
    body: { number: phone, text: message },
    json: true,
    timeout: 30000
  });
}

async function callBackend(path, body) {
  return this.helpers.httpRequest({
    method: 'POST',
    url: `${backendUrl}${path}`,
    headers: {
      'Content-Type': 'application/json',
      'X-MDoctor-Webhook-Secret': n8nSecret,
      'X-Correlation-Id': correlationId,
      'Idempotency-Key': idempotencyKey
    },
    body,
    json: true,
    timeout: 30000
  });
}

let relayResult = null;
let menuAction = 'none';
const sentMessages = [];

if (rawText.toUpperCase().includes('STAGING_E2E_COMPLETE')) {
  const payload = {
    nome: `Paciente WhatsApp ${phone.slice(-4)}`,
    telefone: phone,
    cpf: '12345678909',
    email: `wa.${phone}@staging.invalid`,
    data_nascimento: '15/08/1988',
    condicao: 'hipertensao',
    medicacao: 'losartana 50mg',
    uso_continuo: 'sim',
    receita_anterior: 'sim',
    tempo_uso: '180 dias',
    sinais_alerta: 'NAO',
    lgpd: 'sim',
    consentimento: 'sim',
    from: phone,
    text: rawText,
    rawMessage: { messageId: idempotencyKey, channel: 'whatsapp-evolution', original: ctx.log }
  };
  relayResult = await this.helpers.httpRequest({
    method: 'POST',
    url: n8nTypebotWebhook,
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'Idempotency-Key': idempotencyKey
    },
    body: payload,
    json: true,
    timeout: 30000
  });
  menuAction = 'e2e_relay';
} else if (phone) {
  let surveyHandled = false;
  try {
    const surveyResult = await callBackend('/api/patient-outcomes/survey/inbound', {
      from: phone,
      phone,
      text: rawText
    });
    if (surveyResult?.handled) {
      surveyHandled = true;
      menuAction = surveyResult.completed ? 'post_delivery_survey_completed' : 'post_delivery_survey_step';
      sentMessages.push(menuAction);
    }
  } catch (_surveyError) {
    // segue para menu principal
  }

  if (!surveyHandled) {
  const session = staticData.sessions[phone] || { state: 'menu' };

  const isMenuBack = text === '0' || text === '00' || text.includes('MENU') || text.includes('VOLTAR');
  const isClose = text.includes('ENCERRAR') || text.includes('CANCELAR') || text === 'SAIR';
  const isMedical = text === '1' || text.includes('ATENDIMENTO MEDICO') || text.includes('RENOVACAO');
  const isSupport = text === '2' || text.includes('SUPORTE') || text.includes('EQUIPE') || text.includes('FALAR COM');

  if (session.state === 'support') {
    if (isMenuBack) {
      session.state = 'menu';
      await sendWhatsAppText(MENU_TEXT);
      sentMessages.push('menu');
      menuAction = 'support_to_menu';
    } else if (isClose) {
      await callBackend('/api/whatsapp/support/close', { from: phone, phone });
      session.state = 'menu';
      await sendWhatsAppText(`Atendimento encerrado.\n\n${MENU_TEXT}`);
      sentMessages.push('support_closed');
      menuAction = 'support_closed';
    } else {
      await sendWhatsAppText(SUPPORT_WAIT_TEXT);
      sentMessages.push('support_reminder');
      menuAction = 'support_waiting';
    }
  } else if (session.state === 'typebot') {
    if (isMenuBack) {
      session.state = 'menu';
      await sendWhatsAppText(MENU_TEXT);
      sentMessages.push('menu');
      menuAction = 'typebot_to_menu';
    } else {
      const medicalMsg = [
        'Para continuar o atendimento médico, acesse:',
        typebotUrl,
        '',
        '*0* - Voltar ao menu inicial'
      ].join('\n');
      await sendWhatsAppText(medicalMsg);
      sentMessages.push('typebot_reminder');
      menuAction = 'typebot_reminder';
    }
  } else {
    if (isMedical) {
      session.state = 'typebot';
      const medicalMsg = [
        'Para iniciar o *Atendimento Médico Online*, acesse o assistente:',
        typebotUrl,
        '',
        '_Você será guiado pelo fluxo do Doctor Prescreve._',
        '',
        '*0* - Voltar ao menu inicial'
      ].join('\n');
      await sendWhatsAppText(medicalMsg);
      sentMessages.push('typebot_link');
      menuAction = 'medical_typebot';
    } else if (isSupport) {
      const supportResult = await callBackend('/api/whatsapp/support', { from: phone, phone });
      session.state = 'support';
      await sendWhatsAppText(supportResult?.reply || SUPPORT_WAIT_TEXT);
      sentMessages.push('support_created');
      menuAction = 'support_created';
    } else {
      session.state = 'menu';
      await sendWhatsAppText(MENU_TEXT);
      sentMessages.push('menu');
      menuAction = 'menu_shown';
    }
  }

  staticData.sessions[phone] = session;
  }
}

return [
  {
    json: {
      ...ctx,
      route: 'INBOUND_MESSAGE',
      menuAction,
      relayResult,
      sentMessages,
      typebotUrl,
      log: { ...(ctx.log || {}), phone, menuAction }
    }
  }
];
