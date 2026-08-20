// Teste isolado (sem rede, sem banco) para os TTLs aprovados em 2026-08-20
// (ver docs/PROJECT_MEMORY.md seção 11):
//   - sessão Typebot ativa: 60min de INATIVIDADE (typebot_last_activity_at,
//     gravado a cada startChat/continueChat em typebot-whatsapp.bridge.js —
//     não typebot_session_started_at sozinho)
//   - suporte waiting: 24h desde a abertura (opened_at)
//   - suporte em_atendimento: 24h desde a ÚLTIMA interação do paciente
//     (support_last_interaction_at, gravado por touchSupportInteraction)
//   - awaiting_patient_decision: mantido nos 30min já existentes
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const base = path.join(__dirname, '..', 'src', 'services', 'whatsapp-support.service.js');
const resolveFrom = (p) => path.join(path.dirname(base), p);

let atendimentos = [];
const statusUpdates = [];
stub(resolveFrom('../store/atendimentos.store'), {
  STATUS: { WAITING: 'waiting', EM_ATENDIMENTO: 'em_atendimento', REJECTED: 'rejected' },
  createAtendimento: async (row) => ({ id: 'atd-mock', ...row }),
  listAtendimentos: async () => atendimentos,
  getAtendimento: async (id) => atendimentos.find((a) => a.id === id) || null,
  updateAtendimentoStatus: async (id, status, patch = {}) => {
    statusUpdates.push({ id, status, patch });
    const idx = atendimentos.findIndex((a) => a.id === id);
    const updated = { ...(atendimentos[idx] || { id }), status, ...patch };
    if (idx >= 0) atendimentos[idx] = updated;
    return updated;
  }
});
stub(resolveFrom('../store/audit.store'), { createAuditLog: async () => {} });
stub(resolveFrom('./clinical-persistence.service'), { recordSupportTicket: async () => {} });
stub(resolveFrom('./post-delivery-survey.service'), { handleSurveyInbound: async () => ({ handled: false }) });
stub(resolveFrom('./admin-alert.service'), { notifyAdminAlert: () => {} });

const sessionsByPhone = new Map();
const sessionsById = new Map();
stub(resolveFrom('../store/whatsapp-sessions.store'), {
  getActiveSurveySession: () => null,
  getSessionByPhone: async (phone) => sessionsByPhone.get(phone) || null,
  clearSurveySession: async () => {},
  upsertSessionMetadata: async ({ phone, metadataPatch = {} }) => {
    const existing = sessionsByPhone.get(phone) || { id: `sess-${phone}`, typebot_session_id: null, metadata: {} };
    const merged = { ...existing, metadata: { ...(existing.metadata || {}), ...metadataPatch } };
    sessionsByPhone.set(phone, merged);
    sessionsById.set(merged.id, merged);
    return merged;
  },
  clearTypebotSession: async ({ sessionId }) => {
    for (const [phone, session] of sessionsByPhone.entries()) {
      if (session.id !== sessionId) continue;
      const cleared = { ...session, typebot_session_id: null, metadata: {} };
      sessionsByPhone.set(phone, cleared);
      sessionsById.set(sessionId, cleared);
      return cleared;
    }
    return null;
  }
});

const supportServicePath = require.resolve(base);
delete require.cache[supportServicePath];
const support = require(base);

function isoMinutesAgo(min) {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}
function isoHoursAgo(h) {
  return isoMinutesAgo(h * 60);
}

async function main() {
  const results = {};

  // ── Typebot: sessão ATIVA e recente (last_activity há 5min) continua
  // sendo dona exclusiva — regressão do fix anterior ────────────────────
  {
    const phone = '5511985490001';
    sessionsByPhone.set(phone, {
      id: 'sess-recent',
      typebot_session_id: 'tb-1',
      metadata: { typebot_expected_input_id: 'blk_qualquer', typebot_last_activity_at: isoMinutesAgo(5) }
    });
    const result = await support.resolveMetaInboundRouting({ phone, text: '2', session: sessionsByPhone.get(phone) });
    assert.equal(result.handled, false);
    assert.equal(result.action, 'typebot');
    results.sessaoRecenteContinuaDonaExclusiva = 'ok';
  }

  // ── Typebot: sessão INATIVA há 65min (> 60min TTL) — não é mais dona,
  // cai para o menu, e a sessão é efetivamente limpa (typebot_session_id
  // e expected_input_id somem) ────────────────────────────────────────
  {
    const phone = '5511985490002';
    sessionsByPhone.set(phone, {
      id: 'sess-expired',
      typebot_session_id: 'tb-2',
      metadata: { typebot_expected_input_id: 'blk_qualquer', typebot_last_activity_at: isoMinutesAgo(65) }
    });
    const result = await support.resolveMetaInboundRouting({ phone, text: 'oi novamente', session: sessionsByPhone.get(phone) });
    assert.notEqual(result.action, 'typebot', 'sessão expirada não pode continuar dona da conversa');
    const cleared = sessionsByPhone.get(phone);
    assert.equal(cleared.typebot_session_id, null, 'typebot_session_id deve ser limpo na expiração');
    assert.equal(cleared.metadata.typebot_expected_input_id, undefined, 'typebot_expected_input_id deve ser limpo na expiração');
    assert.equal(cleared.metadata.typebot_last_activity_at, undefined, 'marcadores devem ser limpos na expiração');
    results.sessaoExpirada60minLimpaEVoltaAoMenu = 'ok';
  }

  // ── Typebot: fallback só com typebot_session_started_at (sem
  // last_activity, ex.: sessão em voo criada exatamente no boundary da
  // correção anterior) — 65min desde o início também expira ─────────────
  {
    const phone = '5511985490003';
    sessionsByPhone.set(phone, {
      id: 'sess-legacy-started',
      typebot_session_id: 'tb-3',
      metadata: { typebot_expected_input_id: 'blk_qualquer', typebot_session_started_at: isoMinutesAgo(65) }
    });
    const result = await support.resolveMetaInboundRouting({ phone, text: 'oi', session: sessionsByPhone.get(phone) });
    assert.notEqual(result.action, 'typebot');
    results.fallbackParaSessionStartedAtTambemExpira = 'ok';
  }

  // ── Typebot: sessão LEGADA (criada antes desta correção) — sem
  // typebot_last_activity_at NEM typebot_session_started_at em metadata,
  // só o timestamp real da linha whatsapp_sessions (last_message_at/
  // updated_at, colunas garantidas pela migration). 65min → expira ──────
  {
    const phone = '5511985490010';
    sessionsByPhone.set(phone, {
      id: 'sess-legacy-row-timestamp',
      typebot_session_id: 'tb-legacy',
      metadata: { typebot_expected_input_id: 'blk_qualquer' }, // sem marcadores novos
      last_message_at: isoMinutesAgo(65),
      updated_at: isoMinutesAgo(65)
    });
    const result = await support.resolveMetaInboundRouting({ phone, text: 'oi', session: sessionsByPhone.get(phone) });
    assert.notEqual(result.action, 'typebot', 'sessão legada sem marcadores novos deve expirar usando o timestamp da própria linha');
    results.sessaoLegadaExpiraViaTimestampDaLinha = 'ok';
  }

  // ── Mesmo caso, mas dentro do TTL (10min) — continua ativa ─────────────
  {
    const phone = '5511985490011';
    sessionsByPhone.set(phone, {
      id: 'sess-legacy-row-timestamp-recent',
      typebot_session_id: 'tb-legacy-2',
      metadata: { typebot_expected_input_id: 'blk_qualquer' },
      last_message_at: isoMinutesAgo(10),
      updated_at: isoMinutesAgo(10)
    });
    const result = await support.resolveMetaInboundRouting({ phone, text: 'texto qualquer', session: sessionsByPhone.get(phone) });
    assert.equal(result.action, 'typebot', 'sessão legada dentro do TTL (via timestamp da linha) continua dona da conversa');
    results.sessaoLegadaDentroDoTTLContinuaAtiva = 'ok';
  }

  // ── Suporte waiting: aberto há 25h (> 24h TTL) — closeInactiveSessions
  // fecha, e o ticket deixa de aparecer em getPatientSupportContext ──────
  {
    const phone = '5511985490004';
    atendimentos = [{
      id: 'atd-waiting-expirado',
      status: 'waiting',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: { queue_type: 'support', whatsapp_support: true, opened_at: isoHoursAgo(25) }
    }];
    const closed = await support.closeInactiveSessions();
    assert.equal(closed, 1);
    const ctx = await support.getPatientSupportContext(phone);
    assert.equal(ctx, null, 'ticket waiting expirado não pode mais interferir em nova jornada');
    results.suporteWaiting24hFechaENaoInterfereMais = 'ok';
  }

  // ── Suporte waiting: aberto há 10h (< 24h) — continua aberto ──────────
  {
    const phone = '5511985490005';
    atendimentos = [{
      id: 'atd-waiting-fresco',
      status: 'waiting',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: { queue_type: 'support', whatsapp_support: true, opened_at: isoHoursAgo(10) }
    }];
    const closed = await support.closeInactiveSessions();
    assert.equal(closed, 0);
    const ctx = await support.getPatientSupportContext(phone);
    assert.notEqual(ctx, null, 'ticket waiting dentro do TTL continua aberto');
    results.suporteWaitingDentroDoTTLContinuaAberto = 'ok';
  }

  // ── Suporte em_atendimento: support_started_at há 40h (bem antigo), mas
  // support_last_interaction_at há 2h (paciente respondeu recentemente) —
  // NÃO deve expirar, porque o TTL é desde a ÚLTIMA interação, não desde
  // o início do atendimento ─────────────────────────────────────────────
  {
    const phone = '5511985490006';
    atendimentos = [{
      id: 'atd-atendimento-ativo',
      status: 'em_atendimento',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: {
        queue_type: 'support', whatsapp_support: true, support_sub_status: 'em_atendimento',
        opened_at: isoHoursAgo(40), support_started_at: isoHoursAgo(40), support_last_interaction_at: isoHoursAgo(2)
      }
    }];
    const closed = await support.closeInactiveSessions();
    assert.equal(closed, 0, 'atendimento humano longo mas com interação recente não deve fechar');
    results.emAtendimentoComInteracaoRecenteNaoExpira = 'ok';
  }

  // ── Suporte em_atendimento: última interação há 30h (> 24h) — expira,
  // mesmo tendo começado há pouco tempo (support_started_at recente não
  // importa, o que conta é a última interação real) ─────────────────────
  {
    const phone = '5511985490007';
    atendimentos = [{
      id: 'atd-atendimento-parado',
      status: 'em_atendimento',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: {
        queue_type: 'support', whatsapp_support: true, support_sub_status: 'em_atendimento',
        opened_at: isoHoursAgo(31), support_started_at: isoHoursAgo(31), support_last_interaction_at: isoHoursAgo(30)
      }
    }];
    const closed = await support.closeInactiveSessions();
    assert.equal(closed, 1);
    const ctx = await support.getPatientSupportContext(phone);
    assert.equal(ctx, null, 'ticket em_atendimento parado há 30h não pode mais interferir');
    results.emAtendimentoParado30hExpiraENaoInterfereMais = 'ok';
  }

  // ── touchSupportInteraction: uma interação real do paciente (via
  // resolveMetaInboundRouting, sem Typebot ativo) atualiza
  // support_last_interaction_at no ticket ────────────────────────────────
  {
    const phone = '5511985490008';
    atendimentos = [{
      id: 'atd-toque',
      status: 'em_atendimento',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: {
        queue_type: 'support', whatsapp_support: true, support_sub_status: 'em_atendimento',
        opened_at: isoHoursAgo(5), support_started_at: isoHoursAgo(5)
      }
    }];
    await support.resolveMetaInboundRouting({ phone, text: 'AGUARDAR', session: { id: 'sess-sem-typebot', typebot_session_id: null, metadata: {} } });
    // touchSupportInteraction é fire-and-forget; aguarda um tick de microtask.
    await new Promise((r) => setImmediate(r));
    const ticket = atendimentos.find((a) => a.id === 'atd-toque');
    assert.ok(ticket.dados_clinicos.support_last_interaction_at, 'interação deve gravar support_last_interaction_at');
    results.touchSupportInteractionGravaUltimaInteracao = 'ok';
  }

  // ── awaiting_patient_decision: continua com TTL de 30min (inalterado) ──
  {
    const phone = '5511985490009';
    atendimentos = [{
      id: 'atd-decisao-expirada',
      status: 'waiting',
      paciente_telefone: phone,
      condicao: 'suporte_whatsapp',
      dados_clinicos: { queue_type: 'support', whatsapp_support: true, support_sub_status: 'awaiting_patient_decision', support_finalized_at: isoMinutesAgo(35) }
    }];
    const closed = await support.closeInactiveSessions();
    assert.equal(closed, 1);
    results.awaitingPatientDecisionMantemTTL30min = 'ok';
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error('FALHOU:', e.message, '\n', e.stack); process.exit(1); });
