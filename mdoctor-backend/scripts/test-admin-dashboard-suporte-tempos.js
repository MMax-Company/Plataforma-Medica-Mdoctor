// Testes offline (17/10/2026) dos 2 indicadores de tempo que até aqui
// estavam hardcoded como null: "Suporte Administrativo" (computado a partir
// de support_conversations/support_chat_messages, tabelas do Chat
// Administrativo de Suporte) e "Suporte Médico" (computado a partir de
// medical_support_requested_at/medical_support_resolved_at, já gravados em
// dados_clinicos pelo fluxo real de encaminhamento/resolução). Sem rede, sem
// banco real — mesma técnica de stub de config/supabase por require.cache
// já usada em todo o módulo support-chat. Como admin.routes.js e
// atendimentos.store/support-chat.store apontam para o MESMO
// config/supabase stubado, listDecisoesLog/listStatusHistory (chamados por
// computeTempos para os outros indicadores) naturalmente batem num fake
// client vazio para os IDs sintéticos deste teste — sem precisar stubar
// atendimentos.store à parte.
const assert = require('assert');
const path = require('path');
const { FakeSupabaseClient } = require('./_fakes/fake-supabase-client');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const routesPath = path.join(__dirname, '..', 'src', 'routes', 'admin.routes.js');
const resolveFrom = (p) => path.join(path.dirname(routesPath), p);

const fakeDb = new FakeSupabaseClient({
  uniqueConstraints: {
    support_conversations: [['appointment_id']],
    support_chat_messages: [['conversation_id', 'provider_message_id'], ['conversation_id', 'client_message_id']]
  }
});

stub(resolveFrom('../config/supabase'), {
  isSupabaseConfigured: () => true,
  getSupabase: () => fakeDb
});

const { computeTempos } = require(routesPath);
const supportChatStore = require(resolveFrom('../store/support-chat.store'));

const TEST_NOW = '2026-10-18T12:00:00.000Z';
const computeTemposFixed = (atendimentos) => computeTempos(atendimentos, { now: TEST_NOW });

const results = {};

function baseAtendimento(overrides = {}) {
  return {
    id: `atd-${Math.random().toString(36).slice(2, 10)}`,
    status: 'delivered',
    criado_em: '2026-10-01T10:00:00.000Z',
    dados_clinicos: {},
    ...overrides
  };
}

async function main() {
  // 1) suporte_medico: ciclo completo (requested_at + resolved_at) entra na
  //    amostra e o valor bate com a diferença real entre os dois timestamps.
  {
    const a = baseAtendimento({
      dados_clinicos: {
        medical_support_requested_at: '2026-10-01T12:00:00.000Z',
        medical_support_resolved_at: '2026-10-01T12:30:00.000Z'
      }
    });
    const tempos = await computeTemposFixed([a]);
    assert.equal(tempos.suporte_medico, '30m 00s');
    assert.equal(tempos.amostra_por_indicador.suporte_medico, 1);
    results.suporteMedicoComCicloCompletoEntraNaAmostraComValorCorreto = 'ok';
  }

  // 2) suporte_medico: só requested_at (ainda aguardando o médico) fica de
  //    fora da amostra — nunca inventa um "fim" para quem não foi resolvido.
  {
    const a = baseAtendimento({
      dados_clinicos: { medical_support_requested_at: '2026-10-01T12:00:00.000Z' }
    });
    const tempos = await computeTemposFixed([a]);
    assert.equal(tempos.suporte_medico, null);
    assert.equal(tempos.amostra_por_indicador.suporte_medico, 0);
    results.suporteMedicoSemResolvedAtNuncaInventaUmFim = 'ok';
  }

  // 3) suporte_medico: nenhum atendimento com os marcadores -> null, amostra
  //    0 — nunca um valor fabricado por falta de dado.
  {
    const tempos = await computeTemposFixed([baseAtendimento()]);
    assert.equal(tempos.suporte_medico, null);
    assert.equal(tempos.amostra_por_indicador.suporte_medico, 0);
    results.suporteMedicoSemNenhumMarcoRetornaNullSemInventar = 'ok';
  }

  // 4) suporte_administrativo: conversation com 1 inbound + 1 outbound entra
  //    na amostra, valor = diferença entre a ABERTURA da conversation e a
  //    PRIMEIRA resposta do atendente (não a última, nem o fechamento).
  {
    const { conversation } = await supportChatStore.ensureConversationForAppointment({ appointmentId: 'appt-adm-1', patientId: 'pat-adm-1' });
    // created_at da conversation vem do fake client (now()) — sobrescreve
    // diretamente para controlar o delta esperado no teste.
    const row = fakeDb.rows('support_conversations').find((r) => r.id === conversation.id);
    row.created_at = '2026-10-01T09:00:00.000Z';

    await supportChatStore.recordMessage({ conversationId: conversation.id, direction: 'inbound', body: 'oi', sender: 'patient' });
    const firstOutbound = fakeDb.rows('support_chat_messages').find((m) => m.conversation_id === conversation.id);
    firstOutbound.created_at = '2026-10-01T09:00:00.000Z'; // será sobrescrito abaixo pela mensagem outbound real

    await supportChatStore.recordMessage({ conversationId: conversation.id, direction: 'outbound', body: 'primeira resposta', sender: 'admin' });
    const outboundRow = fakeDb.rows('support_chat_messages').find((m) => m.conversation_id === conversation.id && m.direction === 'outbound');
    outboundRow.created_at = '2026-10-01T09:15:00.000Z';

    // Uma segunda resposta, mais tarde — não pode mudar o cálculo (usa a
    // PRIMEIRA outbound, não a última).
    await supportChatStore.recordMessage({ conversationId: conversation.id, direction: 'outbound', body: 'segunda resposta', sender: 'admin' });
    const allOutbound = fakeDb.rows('support_chat_messages').filter((m) => m.conversation_id === conversation.id && m.direction === 'outbound');
    allOutbound[allOutbound.length - 1].created_at = '2026-10-01T10:00:00.000Z';

    const tempos = await computeTemposFixed([]);
    assert.equal(tempos.suporte_administrativo, '15 min');
    assert.equal(tempos.amostra_por_indicador.suporte_administrativo, 1);
    results.suporteAdministrativoUsaAPrimeiraRespostaNaoAUltima = 'ok';
  }

  // 5) suporte_administrativo: conversation SEM nenhuma resposta ainda fica
  //    de fora da amostra — nunca inventa um "fim" para quem ainda não foi
  //    atendido.
  {
    const before = (await computeTemposFixed([])).amostra_por_indicador.suporte_administrativo;
    const { conversation } = await supportChatStore.ensureConversationForAppointment({ appointmentId: 'appt-adm-sem-resposta', patientId: 'pat-adm-2' });
    await supportChatStore.recordMessage({ conversationId: conversation.id, direction: 'inbound', body: 'oi, alguém aí?', sender: 'patient' });

    const tempos = await computeTemposFixed([]);
    assert.equal(tempos.amostra_por_indicador.suporte_administrativo, before, 'conversation sem outbound não deve entrar na amostra');
    results.suporteAdministrativoSemRespostaNuncaEntraNaAmostra = 'ok';
  }

  // 6) Falha ao consultar support_conversations (ex.: tabela indisponível)
  //    nunca derruba o resto do dashboard — devolve null/0 para este
  //    indicador especificamente.
  {
    const originalListAll = supportChatStore.listAllConversations;
    supportChatStore.listAllConversations = async () => {
      throw new Error('falha simulada ao consultar support_conversations');
    };
    try {
      const tempos = await computeTemposFixed([baseAtendimento()]);
      assert.equal(tempos.suporte_administrativo, null);
      assert.equal(tempos.amostra_por_indicador.suporte_administrativo, 0);
      assert.ok(tempos.pagamento_fila !== undefined, 'resto do objeto tempos deve continuar presente mesmo com essa falha');
      results.falhaAoConsultarSupportConversationsNuncaDerrubaORestoDoDashboard = 'ok';
    } finally {
      supportChatStore.listAllConversations = originalListAll;
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
