const logger = require('../config/logger');
const metaProvider = require('./providers/meta.provider');
const { createIntegrationError } = require('../store/integration-logs.store');
const { claimMetaMessage, finishMetaMessage } = require('../store/whatsapp-meta-receipts.store');
const {
  getSessionByBsuid,
  getSessionByPhone,
  getActiveSurveySession,
  setTypebotSessionId,
  clearTypebotSession,
  upsertSessionIdentity
} = require('../store/whatsapp-sessions.store');
const { validateTypebotInput } = require('./typebot-personal-data.validation');
const { resolveMetaInboundRouting, handleTypebotSupportChoice } = require('./whatsapp-support.service');
const { lookupCep } = require('../routes/cep.routes');

// CEP lookup (enriquecimento interno): quando o paciente informa o CEP no
// bloco blk_0oydu2f7, o bridge consulta a ViaCEP para enriquecer os dados
// da sessão. O resultado é armazenado internamente e NÃO interfere no cursor
// do Typebot nem dispara nenhum continueChat extra. A ordem real publicada é:
//   endereço (q78qjnk6ticwkeifl7xe2rju) → CEP (blk_0oydu2f7) → receita anterior
const CEP_INPUT_ID = 'blk_0oydu2f7';


function getConfig() {
  return {
    viewerUrl: String(process.env.TYPEBOT_VIEWER_URL || '').replace(/\/$/, ''),
    publicId: String(process.env.TYPEBOT_PUBLIC_ID || 'doctor-prescreve-8rmljgu').trim(),
    timeoutMs: Number(process.env.TYPEBOT_RUNTIME_TIMEOUT_MS || 12000),
    retryAttempts: Math.max(1, Number(process.env.TYPEBOT_RETRY_ATTEMPTS || 4)),
    retryBaseDelayMs: Math.max(0, Number(process.env.TYPEBOT_RETRY_BASE_DELAY_MS || 300)),
    retryMaxDelayMs: Math.max(0, Number(process.env.TYPEBOT_RETRY_MAX_DELAY_MS || 2500))
  };
}

function richTextToPlainText(nodes = []) {
  const parts = [];
  const walk = (items) => {
    for (const item of items || []) {
      if (item?.type === 'a') {
        const labelParts = [];
        if (Array.isArray(item.children)) {
          for (const child of item.children) {
            if (typeof child?.text === 'string') labelParts.push(child.text);
          }
        }
        const label = labelParts.join('').trim() || 'Abrir link';
        const url = String(item.url || '').trim();
        if (url) {
          parts.push(label);
          parts.push(url);
        } else if (label) {
          parts.push(label);
        }
        continue;
      }
      if (typeof item?.text === 'string') {
        // Quando o texto de uma variável interpolada ({{var}}) já contém
        // "*" literais (ex.: negrito calculado dinamicamente num Set
        // variable), o Typebot reprocessa o valor substituído como markdown
        // e devolve os trechos como nós "bold"/"italic" em vez de manter os
        // asteriscos literais — perdendo-os na extração de texto puro. Como
        // o WhatsApp usa um único asterisco para negrito nativo, qualquer
        // trecho marcado bold/italic pelo Typebot é reemitido como
        // *texto* para preservar a intenção original (negrito no WhatsApp).
        parts.push(item.bold || item.italic ? `*${item.text}*` : item.text);
      }
      if (Array.isArray(item?.children)) walk(item.children);
      if (item?.type === 'p') parts.push('\n');
    }
  };
  walk(nodes);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function typebotText(message = {}) {
  if (typeof message.content === 'string') return message.content.trim();
  if (typeof message.content?.plainText === 'string') return message.content.plainText.trim();
  return richTextToPlainText(message.content?.richText || message.content || []);
}

// WhatsApp não tem como exibir um rótulo curto escondendo uma URL longa numa
// mensagem de texto simples — o link só fica clicável se aparecer por
// extenso. Por isso, qualquer parágrafo do Typebot que contenha um link
// (ex.: os 5 documentos jurídicos) vira um botão de URL (abre o link
// externamente, sem baixar nada no WhatsApp e sem mostrar a URL), em vez de
// texto simples.
// Meta trunca display_text de botão cta_url em 20 unidades UTF-16 (ver
// sendCtaUrlMessage em providers/meta.provider.js) — os 4 rótulos com
// emoji pedidos (ex.: "📄 Consentimento LGPD" = 21) não cabem por inteiro;
// abreviados ao mínimo para caber, sem emoji.
// Chaves = texto do link tal como está publicado hoje no Typebot.
const DOC_BUTTON_LABELS = {
  'Consentimento LGPD': 'Consentimento LGPD',
  'Política de Privacidade': 'Pol. Privacidade',
  'Consentimento de Telemedicina': 'Telemedicina',
  'Aviso de Não Urgência': 'Não Urgência',
  'Política e Termos de Uso': 'Termos de Uso'
};

function docButtonLabel(label) {
  return DOC_BUTTON_LABELS[label] || String(label || 'Abrir').slice(0, 20);
}

// Restrito aos choice inputs listados abaixo — LGPD, ciência da
// telemedicina, confirmação de dados, declaração de elegibilidade, tempo
// de uso, receita anterior, quantidade de medicamentos, frequência e via
// de administração do 1º medicamento — única exceção onde a pergunta e os
// botões formam uma única mensagem (corpo = a própria pergunta, sem
// "Escolha uma opção:"). Nenhum outro choice input do bot é afetado por
// este conjunto.
const QUESTION_MERGE_INPUT_IDS = new Set([
  'ivbr3o1a7lv8izhfteuerhqx', 'blk_tele_choice', 'plhspmybxbhylbfbsvqyhlmj', 'w9v6g0rlkucnfmxc3qh2a2qt',
  'r0imrcgaiv1idzkykt891q4u', 'blk_receita_choice', 'w97ho902ina4lg7b6dn0sycw', 'blk_yyroio7i', 'blk_nggi0xs0'
]);

// A Meta limita o corpo de botões/listas interativas a 1.024 caracteres.
// Quando uma pergunta mesclável cresce além desse limite (ex.: declaração
// clínica detalhada), o texto completo deve continuar como mensagem separada
// e só a confirmação vira o corpo curto dos botões. Isso evita truncamento
// silencioso sem alterar perguntas que ainda cabem em uma única mensagem.
const INTERACTIVE_BODY_MAX_LENGTH = 1024;
const LONG_CHOICE_CONFIRMATION_BODIES = {
  w9v6g0rlkucnfmxc3qh2a2qt: 'Você confirma que atende a todos os critérios acima?'
};

function richTextContainsLink(nodes = []) {
  for (const item of nodes || []) {
    if (item?.type === 'a') return true;
    if (Array.isArray(item?.children) && richTextContainsLink(item.children)) return true;
  }
  return false;
}

function richTextToOutputs(nodes = []) {
  const outputs = [];
  let buffer = [];
  let sawLink = false;
  const bufferedText = () => buffer.join('').replace(/\n{3,}/g, '\n\n').trim();
  const flushText = () => {
    const text = bufferedText();
    if (text) outputs.push({ kind: 'text', text });
    buffer = [];
  };
  for (const node of nodes || []) {
    const anchor = node?.type === 'p' && Array.isArray(node.children)
      ? node.children.find((child) => child?.type === 'a')
      : null;
    if (anchor) {
      const label = (anchor.children || []).map((c) => (typeof c?.text === 'string' ? c.text : '')).join('').trim();
      const url = String(anchor.url || '').trim();
      if (url && label) {
        // O primeiro link do bloco reaproveita o texto introdutório do grupo
        // (se houver) como corpo do próprio botão, em vez de mandá-lo numa
        // mensagem de texto separada. Links seguintes não repetem esse texto.
        const introText = !sawLink ? bufferedText() : null;
        buffer = [];
        outputs.push({ kind: 'document', url, label, introText: introText || null });
        sawLink = true;
        continue;
      }
    }
    buffer.push(richTextToPlainText([node]));
    buffer.push('\n');
  }
  flushText();
  return outputs;
}

function textInputPrompt(input = {}) {
  const labels = input.options?.labels || input.options || {};
  return String(labels.placeholder || labels.label || '').trim();
}

function convertTypebotResponse(response = {}) {
  const outputs = [];
  for (const message of response.messages || []) {
    if (message?.type !== 'text') continue;
    const richText = Array.isArray(message.content?.richText) ? message.content.richText : null;
    if (richText && richTextContainsLink(richText)) {
      const linkOutputs = richTextToOutputs(richText);
      // O Typebot manda a introdução do grupo (ex.: "Antes de continuar,
      // leia os documentos abaixo:") como uma mensagem de texto própria,
      // logo ANTES da mensagem com os links — não junto no mesmo richText.
      // Se o output anterior é só esse texto puro, ele vira o corpo do
      // primeiro botão de documento, em vez de ficar como mensagem separada.
      const previous = outputs[outputs.length - 1];
      if (previous?.kind === 'text' && linkOutputs[0]?.kind === 'document' && !linkOutputs[0].introText) {
        linkOutputs[0].introText = previous.text;
        outputs.pop();
      }
      outputs.push(...linkOutputs);
      continue;
    }
    const text = typebotText(message);
    if (text) outputs.push({ kind: 'text', text });
  }

  const input = response.input || {};
  const items = Array.isArray(input.items) ? input.items.filter((item) => item?.content || item?.value) : [];
  // Um único response do Typebot só traz um "input" por pergunta, então só um
  // bloco de escolha (buttons/list) deveria existir aqui — mas se algo
  // upstream (ex.: reprocessamento) já tiver deixado outro nos outputs, o
  // filtro abaixo garante que "Escolha uma opção:" seja enviado uma única vez.
  if (input.type === 'choice input' && items.length && !outputs.some((o) => o.kind === 'buttons' || o.kind === 'list')) {
    const choices = items.map((item, index) => {
      const fullLabel = String(item.content || item.value);
      // A Meta limita o título da linha de lista a 24 caracteres — quando o
      // rótulo completo excede isso, a "description" (até 72 caracteres)
      // carrega o texto integral abaixo do título truncado, sem alterar
      // id/value usados no roteamento da resposta.
      const truncated = fullLabel.slice(0, 24);
      return {
        id: String(item.content || item.value || item.id || `choice-${index + 1}`).slice(0, 200),
        title: truncated,
        ...(fullLabel.length > 24 ? { description: fullLabel.slice(0, 72) } : {}),
        value: fullLabel
      };
    });
    // Correção restrita aos inputs listados em QUESTION_MERGE_INPUT_IDS: a
    // pergunta chegava como mensagem de texto separada, seguida de uma
    // segunda mensagem com corpo genérico "Escolha uma opção:" — vira uma
    // única mensagem de botões com a pergunta como corpo. Nenhum outro
    // choice input do bot é afetado.
    let body = 'Escolha uma opção:';
    if (QUESTION_MERGE_INPUT_IDS.has(input.id)) {
      const previous = outputs[outputs.length - 1];
      if (previous?.kind === 'text') {
        if (previous.text.length <= INTERACTIVE_BODY_MAX_LENGTH) {
          body = previous.text;
          outputs.pop();
        } else {
          body = LONG_CHOICE_CONFIRMATION_BODIES[input.id] || body;
        }
      }
    }
    outputs.push(choices.length <= 3
      ? { kind: 'buttons', body, choices }
      : { kind: 'list', body, button: 'Ver opções', choices: choices.slice(0, 10) });
  }

  const hasTextOutput = outputs.some((output) => output.kind === 'text');
  if (input.type === 'text input' && !hasTextOutput) {
    const prompt = textInputPrompt(input);
    if (prompt) outputs.push({ kind: 'text', text: prompt });
  }
  return outputs;
}

function errorPart(error) {
  if (!error) return '';
  const name = error.name && error.name !== 'Error' ? error.name : 'Error';
  const code = error.code ? ` [${error.code}]` : '';
  const status = error.status ? ` HTTP ${error.status}` : '';
  return `${name}${code}${status}: ${String(error.message || error)}`;
}

function describeError(error) {
  const parts = [];
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current) && parts.length < 5) {
    seen.add(current);
    const part = errorPart(current);
    if (part && !parts.includes(part)) parts.push(part);
    current = current.cause;
  }
  return parts.join(' <- ').slice(0, 2000) || 'Erro desconhecido';
}

function isRetryableTypebotError(error) {
  if (typeof error?.retryable === 'boolean') return error.retryable;
  const status = Number(error?.status || 0);
  if ([408, 409, 425, 429].includes(status) || status >= 500) return true;
  const codes = [];
  let current = error;
  while (current) {
    if (current.code) codes.push(String(current.code));
    current = current.cause;
  }
  if (codes.some((code) => /^(ABORT_ERR|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_)/.test(code))) return true;
  return /fetch failed|network|socket|timeout/i.test(describeError(error));
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function callWithRetry(operation, {
  attempts,
  baseDelayMs,
  maxDelayMs,
  sleep = wait,
  onRetry = async () => {}
}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableTypebotError(error);
      if (!retryable || attempt >= attempts) {
        error.retryAttempts = attempt;
        error.retryExhausted = retryable && attempt >= attempts;
        throw error;
      }
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await onRetry(error, { attempt, delayMs, nextAttempt: attempt + 1 });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function fetchTypebot(path, body, { fetchImpl = fetch, config = getConfig() } = {}) {
  if (!config.viewerUrl) throw Object.assign(new Error('TYPEBOT_VIEWER_URL não configurada'), { code: 'TYPEBOT_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response;
    try {
      response = await fetchImpl(`${config.viewerUrl}/api/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (cause) {
      const timeoutReached = cause?.name === 'AbortError';
      const error = new Error(timeoutReached ? 'Timeout na chamada ao Typebot' : 'Falha de rede na chamada ao Typebot', { cause });
      error.code = timeoutReached ? 'TYPEBOT_TIMEOUT' : 'TYPEBOT_FETCH_FAILED';
      error.retryable = true;
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.message || `Typebot HTTP ${response.status}`);
      error.code = 'TYPEBOT_RUNTIME_ERROR';
      error.status = response.status;
      error.retryable = [408, 409, 425, 429].includes(response.status) || response.status >= 500;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function createTypebotWhatsAppBridge(deps = {}) {
  const provider = deps.provider || metaProvider;
  const claim = deps.claimMetaMessage || claimMetaMessage;
  const finish = deps.finishMetaMessage || finishMetaMessage;
  const saveSessionId = deps.setTypebotSessionId || setTypebotSessionId;
  const resetTypebotSession = deps.clearTypebotSession || clearTypebotSession;
  const routeInbound = deps.resolveMetaInboundRouting || resolveMetaInboundRouting;
  const routeSupportChoice = deps.handleTypebotSupportChoice || handleTypebotSupportChoice;
  const logError = deps.createIntegrationError || createIntegrationError;
  const callTypebot = deps.callTypebot || fetchTypebot;
  const sleep = deps.sleep || wait;
  const now = deps.now || (() => new Date());
  const persistExpectedInput = deps.persistExpectedInput || (async ({ identity, inputId }) => upsertSessionIdentity({
    phone: identity?.phone,
    bsuid: identity?.bsuid,
    parentBsuid: identity?.parentBsuid,
    username: identity?.username,
    metadataPatch: { typebot_expected_input_id: inputId || null }
  }));
  const reloadSession = deps.reloadSession || (async ({ identity, whatsappSession }) => {
    if (identity?.phone) return (await getSessionByPhone(identity.phone)) || whatsappSession;
    if (identity?.bsuid) return (await getSessionByBsuid(identity.bsuid)) || whatsappSession;
    return whatsappSession;
  });
  // Lazy require para evitar ciclo com typebot-payment-link.service (que usa
  // fetchTypebot/convertTypebotResponse deste módulo).
  const createPaymentLink = deps.createPaymentLink || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').createPaymentLinkForSession(args));
  const sendPaymentIntro = deps.sendPaymentIntro || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').sendPaymentIntro(args));
  const completePaymentFlow = deps.completePaymentByToken || ((token, args) =>
    // eslint-disable-next-line global-require
    require('./typebot-payment-link.service').completePaymentByToken(token, args));
  const findUploadContext = deps.findUploadContextForPhone || deps.findPendingUploadContext || ((phone) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').findUploadContextForPhone(phone));
  const persistUploadContext = deps.persistUploadContext || ((args) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').persistUploadContext(args));
  const uploadContextFromSession = deps.uploadContextFromSession || ((session, fallback) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').uploadContextFromSession(session, fallback));
  const augmentUploadOutputs = deps.augmentOutputsWithUploadLink || ((outputs, ctx, options) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').augmentOutputsWithUploadLink(outputs, ctx, options));
  const responseLooksLikeUploadStage = deps.responseLooksLikeUploadStage || ((typebot, inputId) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').responseLooksLikeUploadStage(typebot, inputId));
  const isUploadChoiceInput = deps.isUploadChoiceInput || ((inputId) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').isUploadChoiceInput(inputId));
  const isUploadConfirmationText = deps.isUploadConfirmationText || ((value) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').isUploadConfirmationText(value));
  const stripUploadChoiceOutputs = deps.stripUploadChoiceOutputs || ((outputs) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').stripUploadChoiceOutputs(outputs));
  const outputsContainUrl = deps.outputsContainUrl || ((outputs, url) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').outputsContainUrl(outputs, url));
  const uploadSuccessReply = deps.UPLOAD_SUCCESS_REPLY || (
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').UPLOAD_SUCCESS_REPLY
  );
  const getUploadStatus = deps.getUploadStatus || ((token) =>
    // eslint-disable-next-line global-require
    require('./typebot-prescription-upload.service').getUploadStatus(token));
  const sessionQueues = new Map();
  // Removido: cache local (Map) de expectedInputId por identityKey. Ela
  // sobrevivia entre requisições de um mesmo processo e tinha prioridade
  // sobre o valor persistido no Supabase — em cenários com mais de um
  // processo ativo sobre a mesma sessão (ex.: staging e produção habilitados
  // ao mesmo tempo, ou múltiplas réplicas), um processo que "perdia" a
  // corrida do claimMetaMessage nunca atualizava sua cache local, validava a
  // resposta seguinte do paciente contra um input antigo e ficava travado
  // repetindo a pergunta errada indefinidamente. currentSession (recarregada
  // do banco no início de processInbound) é agora a única fonte de verdade.

  async function processInbound({ messageId, text, identity, whatsappSession }, identityKey) {
    const claimed = await claim({ messageId, whatsappSessionId: whatsappSession?.id });
    if (!claimed.claimed) return { duplicate: true, responsesSent: 0, sessionIdReused: Boolean(whatsappSession?.typebot_session_id) };

    const config = getConfig();
    try {
      let currentSession = await reloadSession({ identity, whatsappSession });
      const routing = await routeInbound({
        phone: identity?.phone,
        text,
        session: currentSession
      });

      if (routing?.handled && routing.action === 'reply' && routing.reply) {
        const sent = routing.cta
          ? await provider.sendCtaUrlMessage({
              to: identity.phone,
              bsuid: identity.bsuid,
              correlationId: messageId,
              idempotencyKey: `${messageId}:menu`,
              body: routing.cta.body,
              displayText: routing.cta.displayText,
              url: routing.cta.url
            })
          : await provider.sendTextMessage({
              to: identity.phone,
              bsuid: identity.bsuid,
              correlationId: messageId,
              idempotencyKey: `${messageId}:menu`,
              text: routing.reply
            });
        const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
        await finish({ messageId, status: 'processed', providerMessageIds });
        return {
          duplicate: false,
          responsesSent: providerMessageIds.length,
          sessionId: currentSession?.typebot_session_id || null,
          sessionIdReused: Boolean(currentSession?.typebot_session_id),
          menuHandled: true
        };
      }

      if (getActiveSurveySession(currentSession)?.step) {
        const { handleSurveyInbound } = require('./post-delivery-survey.service');
        const surveyResult = await handleSurveyInbound({
          phone: identity?.phone,
          text,
          correlationId: messageId,
          sendOutbound: false
        });
        if (surveyResult.reply) {
          const sent = await provider.sendTextMessage({
            to: identity.phone,
            bsuid: identity.bsuid,
            correlationId: messageId,
            idempotencyKey: `${messageId}:survey`,
            text: surveyResult.reply
          });
          const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
          await finish({ messageId, status: 'processed', providerMessageIds });
          return {
            duplicate: false,
            responsesSent: providerMessageIds.length,
            sessionId: currentSession?.typebot_session_id || null,
            sessionIdReused: Boolean(currentSession?.typebot_session_id),
            surveyHandled: true
          };
        }
      }

      if (routing?.action === 'typebot_clean' && currentSession?.id) {
        currentSession = await resetTypebotSession({ sessionId: currentSession.id }) || currentSession;
      }

      const existingSessionId = routing?.action === 'typebot_clean'
        ? null
        : (currentSession?.typebot_session_id || null);
      const expectedInputId = currentSession?.metadata?.typebot_expected_input_id || null;
      const uploadContextBeforeChat = uploadContextFromSession(
        currentSession,
        await findUploadContext(identity?.phone)
      );
      let inboundText = String(text || '');

      const atUploadChoiceStage = isUploadChoiceInput(expectedInputId);
      if (uploadContextBeforeChat && atUploadChoiceStage) {
        const uploadStatus = await getUploadStatus(uploadContextBeforeChat.token);
        if (uploadStatus.upload_completed) {
          inboundText = uploadSuccessReply;
        }
      }

      const validation = validateTypebotInput(expectedInputId, inboundText, { now: now() });
      if ((validation.isPersonal || validation.isClinical) && !validation.valid) {
        const sent = await provider.sendTextMessage({
          to: identity.phone,
          bsuid: identity.bsuid,
          correlationId: messageId,
          idempotencyKey: `${messageId}:validation`,
          text: `${validation.error}\n\n${validation.question}`
        });
        const providerMessageIds = sent?.providerMessageId ? [sent.providerMessageId] : [];
        await finish({ messageId, status: 'processed', providerMessageIds });
        return {
          duplicate: false,
          responsesSent: providerMessageIds.length,
          sessionId: existingSessionId,
          sessionIdReused: Boolean(existingSessionId),
          validationFailed: true,
          expectedInputId
        };
      }

      // Enriquecimento interno por CEP: quando o paciente informa o CEP,
      // armazena os dados da ViaCEP na sessão para uso posterior (ex.: webhook
      // de criação do atendimento). Não altera o cursor do Typebot nem
      // intercepta a resposta — o Typebot avança normalmente para receita.
      if (expectedInputId === CEP_INPUT_ID && validation.isPersonal && validation.field === 'cep') {
        lookupCep(validation.value).then((result) => {
          if (result?.encontrado) {
            upsertSessionIdentity({
              phone: identity?.phone,
              bsuid: identity?.bsuid,
              parentBsuid: identity?.parentBsuid,
              username: identity?.username,
              metadataPatch: { cep_lookup: result }
            }).catch(() => {});
          }
        }).catch(() => {});
      }

      const path = existingSessionId
        ? `/sessions/${encodeURIComponent(existingSessionId)}/continueChat`
        : `/typebots/${encodeURIComponent(config.publicId)}/startChat`;
      const message = {
        type: 'text',
        text: (validation.isPersonal || validation.isClinical) ? validation.value : inboundText,
        metadata: { replyId: messageId }
      };
      // DIAGNÓSTICO TEMPORÁRIO (pedido: investigar travamento pós-saudação) —
      // remover após confirmar a causa. Não altera nenhuma decisão, só
      // registra o estado usado para escolher startChat x continueChat.
      logger.info('typebot_bridge_call_diagnostic', {
        messageId,
        identityKey,
        routingAction: routing?.action || null,
        existingSessionId,
        expectedInputIdBefore: expectedInputId,
        callPath: existingSessionId ? 'continueChat' : 'startChat'
      });
      const typebot = await callWithRetry(
        () => callTypebot(path, { message }, { config }),
        {
          attempts: config.retryAttempts,
          baseDelayMs: config.retryBaseDelayMs,
          maxDelayMs: config.retryMaxDelayMs,
          sleep,
          onRetry: async (error, retry) => {
            const detailedError = Object.assign(new Error(describeError(error)), { code: error.code });
            await logError({
              integration: 'typebot_runtime',
              correlationId: messageId,
              error: detailedError,
              request: {
                message_id: messageId,
                whatsapp_session_id: currentSession?.id || null,
                phase: 'retry',
                attempt: retry.attempt,
                next_attempt: retry.nextAttempt,
                backoff_ms: retry.delayMs
              }
            }).catch(() => {});
          }
        }
      );

      const sessionId = existingSessionId || typebot.sessionId;
      if (!sessionId) throw new Error('Typebot não retornou sessionId');
      if (!existingSessionId) await saveSessionId({ sessionId: currentSession.id, typebotSessionId: sessionId });
      const nextInputId = typebot.input?.id || null;
      await persistExpectedInput({ identity, whatsappSession: currentSession, inputId: nextInputId });
      // DIAGNÓSTICO TEMPORÁRIO — ver comentário acima.
      logger.info('typebot_bridge_response_diagnostic', {
        messageId,
        typebotReturnedSessionId: typebot.sessionId || null,
        sessionIdUsed: sessionId,
        sessionIdWasSaved: !existingSessionId,
        nextInputId,
        messageTypes: (typebot.messages || []).map((m) => m.type)
      });
      // DIAGNÓSTICO TEMPORÁRIO (pedido: distinguir convertTypebotResponse x
      // falha silenciosa no envio) — remover após confirmar a causa. Os
      // rótulos de choice input (ex.: "Vamos começar") não são dado pessoal,
      // só limitados em tamanho por segurança.
      logger.info('typebot_bridge_input_diagnostic', {
        messageId,
        inputType: typebot.input?.type || null,
        inputId: typebot.input?.id || null,
        itemsCount: Array.isArray(typebot.input?.items) ? typebot.input.items.length : 0,
        itemLabels: Array.isArray(typebot.input?.items)
          ? typebot.input.items.map((i) => String(i?.content ?? i?.value ?? '').slice(0, 60))
          : []
      });

      const providerMessageIds = [];
      let uploadContext = uploadContextFromSession(currentSession, await findUploadContext(identity?.phone));
      const uploadMeta = currentSession?.metadata?.typebot_prescription_upload || {};
      const linkAlreadySent = Boolean(uploadMeta.link_sent_at);

      let outputs = convertTypebotResponse(typebot);
      // DIAGNÓSTICO TEMPORÁRIO — ver comentário acima.
      logger.info('typebot_bridge_outputs_generated_diagnostic', {
        messageId,
        outputsCount: outputs.length,
        outputKinds: outputs.map((o) => o.kind)
      });
      if (uploadContext && responseLooksLikeUploadStage(typebot, nextInputId)) {
        outputs = stripUploadChoiceOutputs(outputs);
        const hasRetryHint = outputs.some((output) => /link abaixo|enviar foto da receita|não localizamos/i.test(String(output.text || '')));
        outputs = augmentUploadOutputs(outputs, uploadContext, {
          force: !linkAlreadySent && (isUploadChoiceInput(nextInputId) || isUploadChoiceInput(expectedInputId)),
          linkAlreadySent
        });
        if (!linkAlreadySent && (outputsContainUrl(outputs, uploadContext.uploadUrl) || hasRetryHint)) {
          await persistUploadContext({
            identity,
            uploadContext,
            whatsappSession: currentSession,
            linkSentAt: new Date().toISOString()
          });
        } else if (uploadContext) {
          await persistUploadContext({ identity, uploadContext, whatsappSession: currentSession });
        }
      } else if (uploadContext) {
        await persistUploadContext({ identity, uploadContext, whatsappSession: currentSession });
      }

      for (const output of outputs) {
        const common = { to: identity.phone, bsuid: identity.bsuid, correlationId: messageId, idempotencyKey: `${messageId}:${providerMessageIds.length}` };
        let sent;
        if (output.kind === 'buttons') sent = await provider.sendButtonMessage({ ...common, body: output.body, buttons: output.choices });
        else if (output.kind === 'list') sent = await provider.sendListMessage({ ...common, body: output.body, button: output.button, rows: output.choices });
        // A Meta exige `body.text` não-vazio em toda mensagem cta_url (um
        // espaço em branco é rejeitado com erro 131008 "Required parameter
        // is missing" — testado ao vivo). O primeiro botão do grupo usa a
        // introdução do próprio grupo como corpo (nenhuma mensagem de texto
        // separada antes dele); os botões seguintes usam só um ícone neutro,
        // sem repetir o nome do documento nem usar frase de instrução.
        else if (output.kind === 'document') sent = await provider.sendCtaUrlMessage({ ...common, body: output.introText || '📄', displayText: docButtonLabel(output.label), url: output.url });
        else sent = await provider.sendTextMessage({ ...common, text: output.text });
        // DIAGNÓSTICO TEMPORÁRIO — ver comentário acima.
        logger.info('typebot_bridge_output_send_diagnostic', {
          messageId,
          outputKind: output.kind,
          sendFunction: output.kind === 'buttons' ? 'sendButtonMessage'
            : output.kind === 'list' ? 'sendListMessage'
              : output.kind === 'document' ? 'sendCtaUrlMessage'
                : 'sendTextMessage',
          sentWasNullOrUndefined: sent === null || sent === undefined,
          providerMessageId: sent?.providerMessageId || null
        });
        if (sent?.providerMessageId) providerMessageIds.push(sent.providerMessageId);
      }

      // Payment input não tem representação nativa no WhatsApp: cria (ou
      // reaproveita) um Checkout Stripe da MESMA sessão clínica e envia um
      // botão CTA que abre o link seguro. O Typebot só sinaliza que chegou
      // nesta etapa (type === 'payment input') — o Checkout e a confirmação
      // do pagamento são sempre feitos pelo Backend (Fase 2 pedido 2).
      if (typebot.input?.type === 'payment input') {
        try {
          const link = await createPaymentLink({
            identity,
            typebotSessionId: sessionId,
            runtimeOptions: {},
            existingSession: currentSession
          });
          if (link.alreadyPaid) {
            // Sessão já paga (ex.: retomada após confirmação): não reabre
            // Checkout nem reenvia o convite de pagamento, só retoma o fluxo.
            const completed = await completePaymentFlow(link.token, { session: currentSession, provider });
            await finish({ messageId, status: 'processed', providerMessageIds });
            return {
              duplicate: false,
              responsesSent: providerMessageIds.length + (completed.responsesSent || 0),
              sessionId,
              sessionIdReused: Boolean(existingSessionId),
              paymentAlreadyPaid: true
            };
          }
          const introSent = await sendPaymentIntro({
            session: currentSession,
            checkoutRedirectUrl: link.checkoutRedirectUrl,
            correlationId: messageId,
            provider,
            idempotencyPrefix: `${messageId}:payment-intro`
          });
          providerMessageIds.push(...introSent);
        } catch (error) {
          await logError({
            integration: 'typebot_payment_link',
            correlationId: messageId,
            error,
            request: { message_id: messageId, whatsapp_session_id: currentSession?.id || null, phase: 'create_link' }
          }).catch(() => {});
        }
      }

      // Efeito colateral, best-effort: conecta as escolhas do Typebot pós-
      // atendimento ("Falar com o suporte" / "Encerrar atendimento" / grupo
      // "Suporte (fora do fluxo)") à fila de suporte real do backend. O texto
      // que o paciente já recebeu acima vem do próprio Typebot; aqui só
      // criamos/fechamos o atendimento de suporte e, em encerramentos,
      // limpamos a sessão para a próxima mensagem cair no menu inicial.
      try {
        const supportChoice = await routeSupportChoice({
          phone: identity?.phone,
          expectedInputId,
          text,
          correlationId: messageId
        });
        if (supportChoice?.action === 'clear_session' && currentSession?.id) {
          await resetTypebotSession({ sessionId: currentSession.id });
          await persistExpectedInput({ identity, whatsappSession: currentSession, inputId: null });
        }
      } catch (error) {
        await logError({
          integration: 'whatsapp_support',
          correlationId: messageId,
          error,
          request: { message_id: messageId, whatsapp_session_id: currentSession?.id || null, phase: 'post_attendance_support_choice' }
        }).catch(() => {});
      }

      await finish({ messageId, status: 'processed', providerMessageIds });
      return {
        duplicate: false,
        responsesSent: providerMessageIds.length,
        sessionId,
        sessionIdReused: Boolean(existingSessionId),
        retryAttempts: typebot.retryAttempts || undefined
      };
    } catch (error) {
      const exactCause = describeError(error);
      const detailedError = Object.assign(new Error(exactCause), { code: error.code });
      await finish({ messageId, status: 'failed', errorMessage: exactCause }).catch(() => {});
      const errorCode = String(error.code ?? '');
      await logError({
        integration: errorCode.startsWith('META_') || errorCode === 'PROVIDER_ERROR' ? 'meta_whatsapp' : 'typebot_runtime',
        correlationId: messageId,
        error: detailedError,
        request: {
          message_id: messageId,
          whatsapp_session_id: whatsappSession?.id || null,
          retry_attempts: error.retryAttempts || 1,
          retry_exhausted: Boolean(error.retryExhausted)
        }
      }).catch(() => {});
      throw error;
    }
  }

  return async function handleInbound(payload) {
    const identityKey = payload.whatsappSession?.id || payload.identity?.phone || payload.identity?.bsuid || 'unknown';
    const previous = sessionQueues.get(identityKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => processInbound(payload, identityKey));
    sessionQueues.set(identityKey, current);
    try {
      return await current;
    } finally {
      if (sessionQueues.get(identityKey) === current) sessionQueues.delete(identityKey);
    }
  };
}

module.exports = {
  callWithRetry,
  convertTypebotResponse,
  createTypebotWhatsAppBridge,
  describeError,
  fetchTypebot,
  isRetryableTypebotError,
  textInputPrompt
};
