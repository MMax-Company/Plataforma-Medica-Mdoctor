const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getReadinessReport } = require('../config/readiness');
const { sendWhatsAppText } = require('../delivery/delivery.service');
const metaProvider = require('../services/providers/meta.provider');
const logger = require('../config/logger');
const {
  listAtendimentos,
  getAtendimento,
  updateAtendimentoStatus,
  listRecentDecisoesLog,
  statusInGroup,
} = require('../store/atendimentos.store');

const router = express.Router();

const ADMIN_ROLES = ['admin', 'administrativo'];

function countByStatus(atendimentos) {
  return atendimentos.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

function isPaid(atendimento) {
  return String(atendimento.pagamento_status || '').toUpperCase() === 'CONFIRMADO';
}

function isWaiting(atendimento) {
  return statusInGroup(atendimento.status, 'queue');
}

function isInMedicalFlow(atendimento) {
  return statusInGroup(atendimento.status, 'inMedicalFlow');
}

function hasUnresolvedAdminNote(atendimento) {
  const notes = atendimento.dados_clinicos?.observacoes_admin;
  if (!Array.isArray(notes) || !notes.length) return false;
  return notes.some((n) => !n.resolvido);
}

// ─── EXISTING: Tech admin status (admin role only) ───────────────────────────

router.get('/status', requireAuth, requireRole('admin'), async (req, res) => {
  const atendimentos = await listAtendimentos();
  const audit = await listRecentDecisoesLog(25);
  const readiness = getReadinessReport();
  const pendingDelivery = atendimentos.filter((item) => statusInGroup(item.status, 'readyToDeliver'));
  const inMedicalFlow = atendimentos.filter((item) => statusInGroup(item.status, 'inMedicalFlow'));

  res.json({
    success: true,
    user: { id: req.user?.sub, name: req.user?.name || req.user?.username, role: req.user?.role },
    readiness,
    metrics: {
      total: atendimentos.length,
      queue: atendimentos.filter((item) => statusInGroup(item.status, 'queue')).length,
      inMedicalFlow: inMedicalFlow.length,
      readyToDeliver: pendingDelivery.length,
      delivered: atendimentos.filter((item) => statusInGroup(item.status, 'delivered')).length,
      rejected: atendimentos.filter((item) => statusInGroup(item.status, 'rejected')).length,
      byStatus: countByStatus(atendimentos),
    },
    audit,
    integrations: {
      memed: {
        configured: Boolean(process.env.MEMED_API_KEY && process.env.MEMED_SECRET_KEY),
        environment: process.env.MEMED_ENVIRONMENT || process.env.MEMED_ENV || 'development',
      },
      supabase: {
        configured: Boolean(
          process.env.SUPABASE_URL &&
            (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY),
        ),
      },
      delivery: {
        twilioWhatsapp: Boolean(
          process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN &&
            (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM_WHATSAPP),
        ),
        twilioSms: Boolean(
          process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN &&
            (process.env.TWILIO_SMS_FROM || process.env.TWILIO_PHONE_NUMBER),
        ),
        resendEmail: Boolean(
          process.env.RESEND_API_KEY && (process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM),
        ),
      },
    },
  });
});

// ─── OPERATIONAL: Dashboard cards ────────────────────────────────────────────

router.get('/dashboard', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const all = await listAtendimentos();

    const aguardandoPagamento = all.filter(
      (a) => isWaiting(a) && !isPaid(a),
    ).length;

    const aguardandoReceita = all.filter(
      (a) => a.status === 'awaiting_prescription_upload',
    ).length;

    const prontoParaAvaliacao = all.filter(
      (a) => isWaiting(a) && isPaid(a),
    ).length;

    const emAtendimento = all.filter(isInMedicalFlow).length;

    const receitas_prontas = all.filter(
      (a) => statusInGroup(a.status, 'readyToDeliver'),
    ).length;

    const pendenciasAdmin = all.filter(hasUnresolvedAdminNote).length;

    const recentes = all
      .slice(0, 10)
      .map((a) => ({
        id: a.id,
        paciente_nome: a.paciente_nome,
        paciente_telefone: a.paciente_telefone,
        condicao: a.condicao,
        status: a.status,
        pagamento_status: a.pagamento_status,
        criado_em: a.criado_em,
        atualizado_em: a.atualizado_em,
        elegibilidade: a.elegibilidade,
      }));

    res.json({
      success: true,
      cards: {
        aguardando_pagamento: aguardandoPagamento,
        aguardando_receita_anterior: aguardandoReceita,
        pronto_para_avaliacao: prontoParaAvaliacao,
        em_atendimento: emAtendimento,
        receitas_prontas,
        pendencias_admin: pendenciasAdmin,
      },
      total: all.length,
      recentes,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao carregar dashboard' });
  }
});

// ─── OPERATIONAL: Patient list (admin view) ──────────────────────────────────

router.get('/atendimentos', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { status, search } = req.query;
    let all = await listAtendimentos(status ? { status } : {});

    if (search) {
      const q = String(search).toLowerCase();
      all = all.filter((a) => {
        const hay = [a.paciente_nome, a.paciente_telefone, a.paciente_cpf, a.condicao, a.status]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const atendimentos = all.map((a) => ({
      id: a.id,
      paciente_nome: a.paciente_nome,
      paciente_telefone: a.paciente_telefone,
      paciente_cpf: a.paciente_cpf,
      paciente_email: a.paciente_email,
      condicao: a.condicao,
      status: a.status,
      pagamento_status: a.pagamento_status,
      risco: a.risco,
      criado_em: a.criado_em,
      atualizado_em: a.atualizado_em,
      medico_id: a.medico_id,
      elegibilidade: a.elegibilidade,
      dados_clinicos: {
        previous_prescription: a.dados_clinicos?.previous_prescription,
        foto_receita_url: a.dados_clinicos?.foto_receita_url,
        observacoes_admin: a.dados_clinicos?.observacoes_admin || [],
        stripe_checkout_url: a.dados_clinicos?.stripe_checkout_url,
        memed_receita: a.dados_clinicos?.memed_receita,
        entrega_receita: a.dados_clinicos?.entrega_receita,
      },
    }));

    res.json({ success: true, atendimentos, total: atendimentos.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao listar atendimentos' });
  }
});

// ─── OPERATIONAL: Single atendimento (admin view) ────────────────────────────

router.get('/atendimentos/:id', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const atendimento = await getAtendimento(req.params.id);
    if (!atendimento) {
      return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
    }
    res.json({ success: true, atendimento });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao buscar atendimento' });
  }
});

// ─── OPERATIONAL: Add admin note ─────────────────────────────────────────────

router.post('/atendimentos/:id/notes', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { texto } = req.body || {};
    if (!texto || !String(texto).trim()) {
      return res.status(400).json({ success: false, error: 'Texto da observação é obrigatório' });
    }

    const atendimento = await getAtendimento(req.params.id);
    if (!atendimento) {
      return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
    }

    const nota = {
      id: randomUUID(),
      texto: String(texto).trim(),
      autor: req.user.name || req.user.username,
      criado_em: new Date().toISOString(),
      resolvido: false,
    };

    const notasExistentes = Array.isArray(atendimento.dados_clinicos?.observacoes_admin)
      ? atendimento.dados_clinicos.observacoes_admin
      : [];

    const updated = await updateAtendimentoStatus(req.params.id, atendimento.status, {
      dados_clinicos: {
        ...atendimento.dados_clinicos,
        observacoes_admin: [...notasExistentes, nota],
      },
    });

    res.json({ success: true, nota, atendimento: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'Erro ao adicionar observação' });
  }
});

// ─── OPERATIONAL: Resolve admin note ─────────────────────────────────────────

router.patch(
  '/atendimentos/:id/notes/:noteId/resolve',
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const atendimento = await getAtendimento(req.params.id);
      if (!atendimento) {
        return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
      }

      const notas = Array.isArray(atendimento.dados_clinicos?.observacoes_admin)
        ? atendimento.dados_clinicos.observacoes_admin
        : [];

      const notaIdx = notas.findIndex((n) => n.id === req.params.noteId);
      if (notaIdx === -1) {
        return res.status(404).json({ success: false, error: 'Observação não encontrada' });
      }

      const notasAtualizadas = notas.map((n, i) =>
        i === notaIdx ? { ...n, resolvido: true, resolvido_em: new Date().toISOString() } : n,
      );

      const updated = await updateAtendimentoStatus(req.params.id, atendimento.status, {
        dados_clinicos: {
          ...atendimento.dados_clinicos,
          observacoes_admin: notasAtualizadas,
        },
      });

      res.json({ success: true, atendimento: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Erro ao resolver observação' });
    }
  },
);

// ─── OPERATIONAL: Resend Typebot link ────────────────────────────────────────

router.post(
  '/atendimentos/:id/resend-typebot',
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const atendimento = await getAtendimento(req.params.id);
      if (!atendimento) {
        return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
      }

      const typebotUrl =
        process.env.TYPEBOT_PUBLIC_URL ||
        'https://typebot.io/doctor-prescreve-8rmljgu';

      const phone = atendimento.paciente_telefone;
      let sent = false;

      if (phone) {
        try {
          const text = [
            `Olá, ${atendimento.paciente_nome.split(' ')[0]}!`,
            '',
            'Identificamos que seu atendimento no *Doctor Prescreve* ficou pendente.',
            '',
            'Para continuar, acesse o link abaixo e retome de onde parou:',
            typebotUrl,
            '',
            '_Qualquer dúvida, nossa equipe está à disposição._',
          ].join('\n');

          await sendWhatsAppText({
            to: phone,
            text,
            correlationId: `resend-typebot-${atendimento.id}`,
          });
          sent = true;
        } catch {
          // Provider WhatsApp não configurado ou falha — retorna o link para o admin copiar
        }
      }

      res.json({ success: true, link: typebotUrl, sent, phone: phone || null });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Erro ao reenviar link' });
    }
  },
);

// ─── OPERATIONAL: Resend payment link ────────────────────────────────────────

router.post(
  '/atendimentos/:id/resend-payment',
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const atendimento = await getAtendimento(req.params.id);
      if (!atendimento) {
        return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
      }

      const paymentLink =
        atendimento.dados_clinicos?.stripe_checkout_url ||
        atendimento.dados_clinicos?.payment_url ||
        atendimento.dados_clinicos?.pagamento_link ||
        null;

      const phone = atendimento.paciente_telefone;
      let sent = false;

      if (paymentLink && phone) {
        try {
          const text = [
            `Olá, ${atendimento.paciente_nome.split(' ')[0]}!`,
            '',
            'Seu atendimento no *Doctor Prescreve* está aguardando a confirmação do pagamento.',
            '',
            'Acesse o link abaixo para finalizar:',
            paymentLink,
            '',
            '_Após a confirmação, seu pedido será encaminhado para avaliação médica._',
          ].join('\n');

          await sendWhatsAppText({
            to: phone,
            text,
            correlationId: `resend-payment-${atendimento.id}`,
          });
          sent = true;
        } catch {
          // Provider WhatsApp não configurado ou falha
        }
      }

      res.json({
        success: true,
        link: paymentLink,
        sent,
        phone: phone || null,
        pagamento_status: atendimento.pagamento_status,
      });
    } catch (err) {
      res
        .status(500)
        .json({ success: false, error: err.message || 'Erro ao reenviar link de pagamento' });
    }
  },
);

// ─── META WHATSAPP BUSINESS MANAGEMENT: gestão de templates da WABA ─────────
// Capacidade mínima de list + manage exigida para demonstrar o uso real da
// permissão whatsapp_business_management no App Review da Meta. Não ativa
// nada em produção por si só — só expõe a ação quando WHATSAPP_ACCESS_TOKEN/
// WHATSAPP_BUSINESS_ACCOUNT_ID estiverem configurados.

router.get('/whatsapp/templates', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { limit, after } = req.query || {};
    const result = await metaProvider.listMessageTemplates({
      limit: limit ? Number(limit) : undefined,
      after: after || null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.code === 'PROVIDER_NOT_CONFIGURED' ? 409 : 502).json({
      success: false,
      error: err.message || 'Erro ao listar templates WABA',
      code: err.code || 'PROVIDER_ERROR',
    });
  }
});

router.post('/whatsapp/templates', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { name, category, language, components } = req.body || {};
    const result = await metaProvider.createMessageTemplate({ name, category, language, components });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    const status = err.code === 'PROVIDER_NOT_CONFIGURED' ? 409 : err.code === 'INVALID_TEMPLATE_PAYLOAD' ? 400 : 502;
    res.status(status).json({
      success: false,
      error: err.message || 'Erro ao criar template WABA',
      code: err.code || 'PROVIDER_ERROR',
    });
  }
});

router.delete('/whatsapp/templates/:name', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const result = await metaProvider.deleteMessageTemplate({ name: req.params.name });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = err.code === 'PROVIDER_NOT_CONFIGURED' ? 409 : err.code === 'INVALID_TEMPLATE_PAYLOAD' ? 400 : 502;
    res.status(status).json({
      success: false,
      error: err.message || 'Erro ao excluir template WABA',
      code: err.code || 'PROVIDER_ERROR',
    });
  }
});

// ─── COEXISTENCE: Embedded Signup v4 (WhatsApp Business App Coexistence) ────
// Mínimo funcional só de staging: página de teste com o SDK JS oficial da
// Meta, endpoint de config (sem segredos) e endpoint de troca do
// authorization code (autenticado, nunca expõe token/code em log ou
// resposta). Nada aqui dispara onboarding real de nenhum número.

// CSP global (helmet(), server.js) usa script-src 'self' sem exceções — isso
// bloqueava tanto o <script> inline quanto o SDK externo da Meta
// (connect.facebook.net), deixando a página travada em "Carregando
// configuração…" sem nenhum erro capturável no fetch (o navegador só recusa
// executar o script, silenciosamente). Por isso o JS foi extraído para um
// arquivo same-origin e o CSP é sobrescrito só nesta rota — o resto do app
// continua com o CSP padrão do helmet().
const COEXISTENCE_SIGNUP_CSP = [
  "default-src 'self'",
  "script-src 'self' https://connect.facebook.net",
  "connect-src 'self' https://graph.facebook.com https://*.facebook.com",
  "frame-src https://www.facebook.com https://web.facebook.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.facebook.com https://*.fbcdn.net",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

router.get('/whatsapp/coexistence/signup', (_req, res) => {
  res.setHeader('Content-Security-Policy', COEXISTENCE_SIGNUP_CSP);
  res.sendFile(path.join(__dirname, '..', 'views', 'whatsapp-coexistence-signup.html'));
});

router.get('/whatsapp/coexistence/signup.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, '..', 'views', 'whatsapp-coexistence-signup.js'));
});

router.get('/whatsapp/coexistence/config', (_req, res) => {
  const config = metaProvider.getConfig();
  const configuredParts = metaProvider.getConfiguredParts(config);
  res.json({
    success: true,
    appId: config.appId || null,
    graphApiVersion: config.apiVersion,
    embeddedSignupConfigId: config.embeddedSignupConfigId || null,
    embeddedSignupConfigured: metaProvider.isEmbeddedSignupConfigured(),
    coexistenceExchangeConfigured: metaProvider.isCoexistenceExchangeConfigured(),
    configuredParts: {
      appId: configuredParts.appId,
      embeddedSignupConfigId: configuredParts.embeddedSignupConfigId,
      appSecret: configuredParts.appSecret,
    },
  });
});

router.post('/whatsapp/coexistence/exchange-code', requireAuth, requireRole(...ADMIN_ROLES), async (req, res) => {
  const { code, phoneNumberId, wabaId, businessId } = req.body || {};
  try {
    const result = await metaProvider.exchangeEmbeddedSignupCode({ code });
    logger.info('whatsapp_coexistence_code_exchanged', {
      actor: req.user?.sub || 'admin',
      phoneNumberId: phoneNumberId || null,
      wabaId: wabaId || null,
      businessId: businessId || null,
      tokenType: result.tokenType,
      expiresIn: result.expiresIn,
    });
    res.json({ success: true, ...result, capturedIdentity: { phoneNumberId: phoneNumberId || null, wabaId: wabaId || null, businessId: businessId || null } });
  } catch (err) {
    logger.warn('whatsapp_coexistence_code_exchange_failed', {
      actor: req.user?.sub || 'admin',
      error: err.message,
      code: err.code || null,
    });
    const status = err.code === 'PROVIDER_NOT_CONFIGURED' ? 409 : err.code === 'INVALID_EXCHANGE_PAYLOAD' ? 400 : 502;
    res.status(status).json({
      success: false,
      error: err.message || 'Erro ao trocar code do Embedded Signup',
      code: err.code || 'PROVIDER_ERROR',
    });
  }
});

module.exports = router;
