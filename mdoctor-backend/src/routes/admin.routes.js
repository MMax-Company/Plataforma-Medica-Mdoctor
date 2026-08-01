const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const { requireAuth, requireRole } = require('../auth/auth.middleware');
const { getReadinessReport } = require('../config/readiness');
const { sendWhatsAppText } = require('../delivery/delivery.service');
const metaProvider = require('../services/providers/meta.provider');
const logger = require('../config/logger');
const {
  STATUS,
  listAtendimentos,
  getAtendimento,
  updateAtendimentoStatus,
  listRecentDecisoesLog,
  listDecisoesLog,
  statusInGroup,
} = require('../store/atendimentos.store');
const { PAYMENT_AMOUNT_CENTS, PAYMENT_AMOUNT_LABEL } = require('../services/typebot-payment.constants');
const { createAuditLog } = require('../store/audit.store');
const { QUEUE_TYPE_MEDICAL_SUPPORT, isSupportQueue } = require('../constants/whatsapp-queue');

const router = express.Router();

const ADMIN_ROLES = ['admin', 'administrativo'];

function countByStatus(atendimentos) {
  return atendimentos.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}

// Exclusão de atendimentos de teste do painel: não existe campo no banco que
// marque um registro como teste (levantado em auditoria pontual, 01/08) —
// scripts de seed/homologação/staging inserem pelo mesmo caminho de um
// atendimento real. A lista abaixo cobre os telefones fixos e padrões de
// nome usados por esses scripts (mdoctor-backend/scripts/seed-*.js,
// test-*.js, prepare-staging-test-patients.js etc.). Registros reais nunca
// batem com isso — só exclui o que é comprovadamente sintético.
const RAW_TEST_PHONES = [
  '11999999999',
  '5511999999999',
  '11987654321',
  '11976543210',
  '11965432109',
  '11991230001',
  '21992340002',
  '31993450003',
  '41994560004',
  '51995670005',
  '62996780006',
  '71997890007',
  '81998900008',
  '85999010009',
  '91990120010',
  '11999990000',
  '5511999990000',
  '11968123900',
  '5511900000009',
  '5511900000000',
  '11985485777',
  '5511985485777',
];

function normalizeTestPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 11 && digits[2] === '9') digits = digits.slice(0, 2) + digits.slice(3);
  return digits;
}

const TEST_PHONES_NORMALIZED = new Set(RAW_TEST_PHONES.map(normalizeTestPhone));

// supabase-production-persistence-test.js gera telefone dinâmico
// `5511977${Date.now()}`.slice(-6) — normalizado sempre cai em "1177" + 6
// dígitos.
const TEST_PHONE_PREFIX_RE = /^1177\d{6}$/;

const TEST_NAME_RE =
  /\bteste\b|\btest\b|\bhom ?p\d|\bsim ?p\d|playwright|simula[cç][aã]o|persist[eê]ncia|\bqa\b|fict[ií]cio|valida[cç][aã]o/i;

function isTestAtendimento(atendimento) {
  if (TEST_NAME_RE.test(String(atendimento.paciente_nome || ''))) return true;
  const phone = normalizeTestPhone(atendimento.paciente_telefone);
  if (!phone) return false;
  return TEST_PHONES_NORMALIZED.has(phone) || TEST_PHONE_PREFIX_RE.test(phone);
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

// Indicador financeiro: soma o valor real da consulta (mesmo preço fixo usado
// no link de pagamento Stripe, typebot-payment.constants.js) para cada
// atendimento com pagamento efetivamente confirmado. Não é um valor
// registrado por atendimento (o produto é preço único), então não há campo
// a backfillar — a receita é sempre atendimentos_pagos × valor_unitario.
const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function computeFinanceiro(atendimentos) {
  const pagos = atendimentos.filter(isPaid);
  const receitaTotalCentavos = pagos.length * PAYMENT_AMOUNT_CENTS;
  return {
    atendimentos_pagos: pagos.length,
    valor_unitario_centavos: PAYMENT_AMOUNT_CENTS,
    valor_unitario_label: PAYMENT_AMOUNT_LABEL,
    receita_total_centavos: receitaTotalCentavos,
    receita_total_label: BRL_FORMATTER.format(receitaTotalCentavos / 100),
  };
}

function minutesBetween(fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return (to - from) / 60000;
}

function average(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((sum, v) => sum + v, 0) / clean.length;
}

function formatMinutes(minutes) {
  if (minutes === null) return null;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

// Indicadores de tempo médio: correlacionam timestamps já gravados pelo
// fluxo real (nada aqui é inventado), sobre atendimentos concluídos
// (status "delivered" ou "rejected").
//
// Fontes usadas por indicador:
//   - Triagem clínica: dados_clinicos.jornada.primeiro_oi_em (primeira
//                       mensagem do paciente no ciclo atual — marcador staged
//                       em whatsapp_sessions.metadata e consumido no webhook
//                       do n8n, ver whatsapp.routes.js e
//                       whatsapp-sessions.store.js) → atendimentos.criado_em
//                       (entrada na fila médica, mesmo webhook do n8n).
//   - Espera médica  : atendimentos.criado_em → medical_decisions.criado_em
//                       da PRIMEIRA transição para status "em_atendimento"
//                       (clique em "Atender" no painel médico — PATCH
//                       /:id/status).
//   - Avaliação médica: mesma transição "em_atendimento" acima →
//                       dados_clinicos.clinical_audit.approvedAt ou
//                       .rejectedAt (clique em Aprovar/Reprovar).
//   - Emissão da receita: clinical_audit.approvedAt (Aprovar, abertura do
//                       fluxo Memed) → dados_clinicos.entrega_receita.sent_at
//                       (receita entregue ao WhatsApp para envio ao
//                       paciente) — só se aplica a atendimentos "delivered".
//   - Jornada completa: dados_clinicos.jornada.primeiro_oi_em (mesmo marcador
//                       da Triagem clínica, é o início do ciclo) →
//                       dados_clinicos.jornada.pos_entrega_enviada_em
//                       (envio da mensagem pós-entrega com as opções
//                       1/2/3 — gravado em post-delivery-survey.service.js)
//                       — só se aplica a atendimentos "delivered"; as
//                       respostas do questionário não entram na métrica.
//
// O marcador de jornada (primeiro_oi_em) só existe para atendimentos criados
// PELO fluxo real WhatsApp → n8n → webhook a partir desta implementação —
// atendimentos concluídos antes dela, criados por outra via (teste manual,
// migração) ou cujo telefone não bateu com nenhuma sessão ficam de fora da
// amostra desses dois indicadores especificamente (nunca um número
// fabricado). "Suporte administrativo" e "Suporte médico" seguem sem evento
// distinto no modelo de dados atual.
async function findPrimeiraTransicaoEmAtendimento(atendimentoId) {
  const decisoes = await listDecisoesLog(atendimentoId);
  const transicoes = decisoes.filter((d) => d.status_novo === STATUS.EM_ATENDIMENTO);
  if (!transicoes.length) return null;
  return transicoes.reduce(
    (earliest, d) => (!earliest || new Date(d.criado_em) < new Date(earliest) ? d.criado_em : earliest),
    null,
  );
}

async function computeTempos(atendimentos) {
  // Tickets de Suporte Geral via WhatsApp (isSupportQueue) nunca passam pelo
  // pipeline triagem → fila médica → avaliação → emissão — não são
  // atendimentos clínicos, então ficam fora da amostra destes indicadores.
  const concluidos = atendimentos.filter(
    (a) => (a.status === STATUS.DELIVERED || a.status === STATUS.REJECTED) && !isSupportQueue(a),
  );

  const comAtendidoEm = await Promise.all(
    concluidos.map(async (a) => ({ atendimento: a, atendidoEm: await findPrimeiraTransicaoEmAtendimento(a.id) })),
  );

  const triagemValues = [];
  const esperaMedicaValues = [];
  const avaliacaoValues = [];
  const emissaoReceitaValues = [];
  const jornadaCompletaValues = [];

  for (const { atendimento: a, atendidoEm } of comAtendidoEm) {
    const c = a.dados_clinicos || {};
    const decisaoEm = c.clinical_audit?.approvedAt || c.clinical_audit?.rejectedAt || null;
    const jornada = c.jornada || {};

    if (jornada.primeiro_oi_em) {
      const triagem = minutesBetween(jornada.primeiro_oi_em, a.criado_em);
      if (triagem !== null) triagemValues.push(triagem);
    }

    if (atendidoEm) {
      const espera = minutesBetween(a.criado_em, atendidoEm);
      if (espera !== null) esperaMedicaValues.push(espera);

      if (decisaoEm) {
        const avaliacao = minutesBetween(atendidoEm, decisaoEm);
        if (avaliacao !== null) avaliacaoValues.push(avaliacao);
      }
    }

    if (a.status === STATUS.DELIVERED && c.clinical_audit?.approvedAt) {
      const entregaEm = c.entrega_receita?.sent_at || c.historico_receita?.ultimo_envio_em || null;
      if (entregaEm) {
        const emissao = minutesBetween(c.clinical_audit.approvedAt, entregaEm);
        if (emissao !== null) emissaoReceitaValues.push(emissao);
      }
    }

    if (a.status === STATUS.DELIVERED && jornada.primeiro_oi_em && jornada.pos_entrega_enviada_em) {
      const jornadaCompleta = minutesBetween(jornada.primeiro_oi_em, jornada.pos_entrega_enviada_em);
      if (jornadaCompleta !== null) jornadaCompletaValues.push(jornadaCompleta);
    }
  }

  return {
    // Amostra do cabeçalho: só atendimentos com jornada completa (marcadores
    // primeiro_oi_em + pos_entrega_enviada_em) E receita entregue (status
    // delivered) — mesmo critério de jornadaCompletaValues acima. Rejeitados
    // e entregues sem marcador de jornada ficam de fora daqui (mas seguem
    // contando nos indicadores que não dependem desses dois marcadores).
    amostra: jornadaCompletaValues.length,
    amostra_por_indicador: {
      triagem: triagemValues.length,
      espera_medica: esperaMedicaValues.length,
      avaliacao: avaliacaoValues.length,
      emissao_receita: emissaoReceitaValues.length,
      jornada_completa: jornadaCompletaValues.length,
    },
    triagem: formatMinutes(average(triagemValues)),
    espera_medica: formatMinutes(average(esperaMedicaValues)),
    avaliacao: formatMinutes(average(avaliacaoValues)),
    emissao_receita: formatMinutes(average(emissaoReceitaValues)),
    jornada_completa: formatMinutes(average(jornadaCompletaValues)),
    suporte_administrativo: null,
    suporte_medico: null,
  };
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
    const allRaw = await listAtendimentos();
    // Atendimentos de teste (seeds/scripts de staging — ver isTestAtendimento)
    // nunca devem aparecer nos cards, indicadores ou receita do painel.
    const semTeste = allRaw.filter((a) => !isTestAtendimento(a));
    // Ticket de Suporte Geral via WhatsApp (isSupportQueue: queue_type
    // "support", whatsapp_support ou condicao "suporte_whatsapp") não é
    // atendimento clínico — nunca entra em cards, financeiro, indicadores,
    // total ou recentes. Não confundir com "medical_support" (atendimento
    // clínico real, só temporariamente encaminhado ao suporte médico — esse
    // continua clínico e segue a exclusão própria dos cards logo abaixo).
    const all = semTeste.filter((a) => !isSupportQueue(a));
    // Atendimentos encaminhados ao médico somem das colunas do corpo principal
    // (ver admin/dashboard/page.tsx) — os 6 cards precisam da mesma exclusão,
    // senão "Pendências administrativas" pode contar um caso que já não
    // aparece na coluna correspondente (nota antiga não resolvida + em espera
    // de resposta médica ao mesmo tempo).
    const cardsVisiveis = all.filter((a) => a.dados_clinicos?.queue_type !== 'medical_support');

    const aguardandoPagamento = cardsVisiveis.filter(
      (a) => isWaiting(a) && !isPaid(a),
    ).length;

    const aguardandoReceita = cardsVisiveis.filter(
      (a) => a.status === 'awaiting_prescription_upload',
    ).length;

    const prontoParaAvaliacao = cardsVisiveis.filter(
      (a) => isWaiting(a) && isPaid(a),
    ).length;

    const emAtendimento = cardsVisiveis.filter(isInMedicalFlow).length;

    const receitas_prontas = cardsVisiveis.filter(
      (a) => statusInGroup(a.status, 'readyToDeliver'),
    ).length;

    const pendenciasAdmin = cardsVisiveis.filter(hasUnresolvedAdminNote).length;

    const tempos = await computeTempos(all);

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
      financeiro: computeFinanceiro(all),
      tempos,
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
    // Ticket de Suporte Geral via WhatsApp não é atendimento clínico — nunca
    // aparece na Relação de Pacientes nem nas colunas do dashboard (esta
    // rota alimenta as duas telas). Tickets ativos seguem visíveis só na
    // faixa/fila própria de suporte (/api/atendimentos/support-queue).
    all = all.filter((a) => !isTestAtendimento(a) && !isSupportQueue(a));

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
      numero_curto: a.numero_curto,
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
        motivo_rejeicao: a.dados_clinicos?.motivo_rejeicao || null,
        support_sub_status: a.dados_clinicos?.support_sub_status || null,
        queue_type: a.dados_clinicos?.queue_type || null,
        medical_support_reason: a.dados_clinicos?.medical_support_reason || null,
        medical_support_requested_at: a.dados_clinicos?.medical_support_requested_at || null,
        // medico_id (coluna) é sempre null com o login atual (username, não
        // numérico) — o responsável real fica em clinical_audit.
        clinical_audit: a.dados_clinicos?.clinical_audit
          ? {
              approvedBy: a.dados_clinicos.clinical_audit.approvedBy || null,
              rejectedBy: a.dados_clinicos.clinical_audit.rejectedBy || null,
            }
          : null,
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
      // updateAtendimentoStatus zera medico_id/motivo_decisao se não forem
      // repassados — adicionar uma observação não deve apagar quem decidiu
      // o atendimento nem o motivo da decisão.
      medicoId: atendimento.medico_id,
      motivo: atendimento.motivo_decisao,
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
        // ver comentário equivalente na rota de adicionar observação acima.
        medicoId: atendimento.medico_id,
        motivo: atendimento.motivo_decisao,
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

// ─── OPERATIONAL: Forward to doctor (fluxo Suporte Médico) ──────────────────
// Encaminha um atendimento clínico real (nunca um ticket de Suporte Geral) para
// esclarecimento médico pontual. Nunca cria atendimento, altera receita ou
// reabre avaliação clínica — só sinaliza dados_clinicos.queue_type, lido pelo
// Painel Médico (GET /api/atendimentos/medical-support-queue).

router.post(
  '/atendimentos/:id/forward-to-doctor',
  requireAuth,
  requireRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { motivo } = req.body || {};
      if (!motivo || !String(motivo).trim()) {
        return res.status(400).json({ success: false, error: 'Motivo do encaminhamento é obrigatório' });
      }

      const atendimento = await getAtendimento(req.params.id);
      if (!atendimento) {
        return res.status(404).json({ success: false, error: 'Atendimento não encontrado' });
      }

      if (isSupportQueue(atendimento)) {
        return res.status(400).json({
          success: false,
          error: 'Tickets de Suporte Geral não podem ser encaminhados ao médico — não são atendimentos clínicos.',
        });
      }

      if (!statusInGroup(atendimento.status, 'delivered')) {
        return res.status(409).json({
          success: false,
          error: 'Somente atendimentos clínicos concluídos, com receita entregue, podem ser encaminhados ao suporte médico.',
        });
      }

      if (atendimento.dados_clinicos?.queue_type === QUEUE_TYPE_MEDICAL_SUPPORT) {
        return res.status(409).json({
          success: false,
          error: 'Este atendimento já aguarda resposta do suporte médico.',
        });
      }

      const now = new Date().toISOString();
      const updated = await updateAtendimentoStatus(req.params.id, atendimento.status, {
        // updateAtendimentoStatus sempre reescreve medico_id/motivo_decisao a
        // partir de meta — sem repassar os valores atuais, esta ação (que não
        // deveria mexer em nada disso) os zeraria silenciosamente.
        medicoId: atendimento.medico_id,
        motivo: atendimento.motivo_decisao,
        dados_clinicos: {
          ...atendimento.dados_clinicos,
          queue_type: QUEUE_TYPE_MEDICAL_SUPPORT,
          medical_support_reason: String(motivo).trim(),
          medical_support_requested_at: now,
        },
      });

      await createAuditLog({
        entity_type: 'atendimento',
        entity_id: req.params.id,
        action: 'forwarded_to_doctor',
        actor: req.user?.name || req.user?.username || 'admin',
        payload: { atendimento_id: req.params.id, motivo: String(motivo).trim() },
      });

      res.json({ success: true, atendimento: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message || 'Erro ao encaminhar ao médico' });
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
// Exposto para validação isolada dos indicadores de tempo (ex.: script de
// conferência contra atendimentos concluídos reais) sem precisar subir o
// servidor HTTP nem autenticação.
module.exports.computeTempos = computeTempos;
module.exports.isTestAtendimento = isTestAtendimento;
