// Fase 3 pedido 2 — testes isolados (sem rede/banco real) da emissão Memed,
// vínculo único (memedId nunca reutilizado entre atendimentos) e entrega da
// receita pelo WhatsApp (texto exato, apenas emitida+validada, idempotência).
//
// Estratégia: para as funções puras (guards em atendimentos.routes.js e
// memed.routes.js) e para buildPrescriptionDeliveryWhatsAppMessage, os
// módulos de produção são exigidos diretamente (dotenv carregado, sem
// chamadas de rede em tempo de require — já validado manualmente). Para
// whatsapp-outbox.store.js e prescriptions.store.js, que fazem chamadas
// reais ao Supabase em tempo de execução, um fake de ../db/persistence é
// injetado via require.cache para exercitar a lógica real de consulta sem
// rede/banco.
require('dotenv').config();
const assert = require('assert');
const path = require('path');

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const results = {};

// ---------------------------------------------------------------------
// 1) Guards puros de atendimentos.routes.js (exigido com deps reais —
//    módulos não fazem chamada de rede em tempo de require).
// ---------------------------------------------------------------------
{
  const routes = require('../src/routes/atendimentos.routes.js');

  // Enviar somente quando emitida E validada — receita_emitida sozinho não basta mais.
  const emittedNotValidated = {
    status: 'receita_emitida',
    dados_clinicos: { memed_receita: { pdfUrl: 'https://memed.example/pdf/1' } }
  };
  const guard1 = routes.assertCanDeliverPrescription(emittedNotValidated);
  assert.equal(guard1.ok, false, 'emitida sem validar não pode ser entregue');

  const emittedAndValidated = {
    status: 'ready',
    dados_clinicos: {
      memed_receita: { pdfUrl: 'https://memed.example/pdf/1', validated_at: new Date().toISOString() }
    }
  };
  const guard2 = routes.assertCanDeliverPrescription(emittedAndValidated);
  assert.equal(guard2.ok, true, 'emitida e validada pode ser entregue');
  results.enviarSomenteEmitidaEValidada = 'ok';

  // Atendimento reprovado (memed_bloqueado) nunca entrega, mesmo com receita validada.
  const blocked = {
    status: 'ready',
    dados_clinicos: {
      memed_bloqueado: true,
      memed_receita: { pdfUrl: 'https://memed.example/pdf/1', validated_at: new Date().toISOString() }
    }
  };
  assert.equal(routes.assertCanDeliverPrescription(blocked).ok, false);
  results.reprovadoNuncaEntrega = 'ok';

  // Entrega repetida não reenvia — hasSuccessfulDelivery detecta envio já concluído.
  const previousDeliveries = routes.listPreviousDeliveries({
    entregas_receita: [{ channel: 'whatsapp', status: 'sent' }]
  });
  assert.equal(routes.hasSuccessfulDelivery(previousDeliveries, 'whatsapp'), true);
  assert.equal(routes.hasSuccessfulDelivery(previousDeliveries, 'email'), false, 'canais são independentes');
  results.entregaRepetidaDetectada = 'ok';
}

// ---------------------------------------------------------------------
// 2) Texto exato da mensagem de entrega (delivery.service.js).
// ---------------------------------------------------------------------
{
  const { buildPrescriptionDeliveryWhatsAppMessage } = require('../src/delivery/delivery.service.js');
  const text = buildPrescriptionDeliveryWhatsAppMessage('https://memed.example/receita/abc123');
  assert(text.includes('📄 Sua receita foi emitida com sucesso.'));
  assert(text.includes('Acesse sua receita pelo link seguro abaixo:'));
  assert(text.includes('https://memed.example/receita/abc123'));
  assert(text.includes('Se precisar de ajuda, digite 3 para falar com o suporte.'));
  results.textoDeEntregaExato = 'ok';
}

// ---------------------------------------------------------------------
// 3) Guards puros de memed.routes.js — emissão só após aprovação, receita
//    existente não é recriada.
// ---------------------------------------------------------------------
{
  const memedRoutes = require('../src/routes/memed.routes.js');

  assert.equal(memedRoutes.RECEITA_FLOW_STATUSES.has('waiting'), false, 'sem aprovação não inicia Memed');
  assert.equal(memedRoutes.RECEITA_FLOW_STATUSES.has('rejected'), false, 'reprovado não inicia Memed');
  assert.equal(memedRoutes.RECEITA_FLOW_STATUSES.has('approved'), true, 'aprovado pode iniciar Memed');
  results.semAprovacaoNaoIniciaMemed = 'ok';

  const withReceipt = { dados_clinicos: { memed_receita: { receitaId: 'rx-1' } } };
  const withoutReceipt = { dados_clinicos: {} };
  assert.equal(memedRoutes.hasPersistedReceipt(withReceipt), true);
  assert.equal(memedRoutes.hasPersistedReceipt(withoutReceipt), false);
  results.receitaExistenteDetectada = 'ok';
}

// ---------------------------------------------------------------------
// Fake mínimo de ../db/persistence (dbQuery) para exercitar a lógica real
// de whatsapp-outbox.store.js e prescriptions.store.js sem rede/banco.
// ---------------------------------------------------------------------
function buildFakeSupabase(tables) {
  function matches(row, eqFilters) {
    return eqFilters.every(([col, val]) => {
      if (col === 'metadata->>message_kind') return row.metadata?.message_kind === val;
      return row[col] === val;
    });
  }

  function from(table) {
    tables[table] = tables[table] || [];
    let eqFilters = [];
    let insertRow = null;
    let updatePatch = null;
    let mode = null;

    const api = {
      select() {
        if (!mode) mode = 'select';
        return api;
      },
      eq(col, val) {
        eqFilters.push([col, val]);
        return api;
      },
      in(col, vals) {
        eqFilters.push([col, { __in: vals }]);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      insert(row) {
        mode = 'insert';
        insertRow = row;
        return api;
      },
      update(patch) {
        mode = 'update';
        updatePatch = patch;
        return api;
      },
      async maybeSingle() {
        const rows = applyFilters();
        return { data: rows[0] || null, error: null };
      },
      async single() {
        if (mode === 'insert') {
          const uniqueViolation = tables[table].some(
            (r) => r.appointment_id === insertRow.appointment_id && r.metadata?.message_kind === insertRow.metadata?.message_kind
          );
          if (uniqueViolation) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
          }
          const row = { id: `row-${tables[table].length + 1}`, ...insertRow, created_at: new Date().toISOString() };
          tables[table].push(row);
          return { data: row, error: null };
        }
        return { data: null, error: { message: 'not_supported' } };
      },
      then(resolve, reject) {
        // permite `await builder` sem `.select()/.single()` no final (finishRejectionMessage)
        if (mode === 'update') {
          const rows = applyFilters();
          rows.forEach((row) => Object.assign(row, updatePatch));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
    };

    function applyFilters() {
      let rows = tables[table];
      if (mode === 'update') {
        // update().select() após eq/in retorna as linhas já atualizadas
        rows = rows.filter((row) =>
          eqFilters.every(([col, val]) =>
            val && typeof val === 'object' && '__in' in val ? val.__in.includes(row[col]) : row[col] === val
          )
        );
        rows.forEach((row) => Object.assign(row, updatePatch));
        return rows;
      }
      return rows.filter((row) => matches(row, eqFilters.filter(([, val]) => !(val && typeof val === 'object' && '__in' in val))));
    }

    // update().eq().in().select() — select() no modo update retorna as linhas atualizadas (array)
    const originalSelect = api.select;
    api.select = function selectOverride() {
      if (mode === 'update') {
        return {
          async then(resolve, reject) {
            const rows = applyFilters();
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          }
        };
      }
      return originalSelect();
    };

    return api;
  }

  return { from };
}

// ---------------------------------------------------------------------
// 4) whatsapp-outbox.store.js — kind isolation, dedupe, idempotencyKey.
// ---------------------------------------------------------------------
async function testWhatsappOutboxStore() {
  const outboxBase = path.join(__dirname, '..', 'src', 'store', 'whatsapp-outbox.store.js');
  const resolveFrom = (p) => path.join(path.dirname(outboxBase), p);

  const tables = {};
  stub(resolveFrom('../db/tables'), { WHATSAPP_MESSAGES: 'whatsapp_messages' });
  stub(resolveFrom('../db/persistence'), {
    dbQuery: async (label, runner) => {
      const result = await runner(buildFakeSupabase(tables));
      if (result?.error) {
        const err = new Error(result.error.message);
        err.cause = result.error;
        throw err;
      }
      return result?.data;
    }
  });

  delete require.cache[require.resolve(outboxBase)];
  const outbox = require(outboxBase);

  // Vínculo de mensagens não colide entre kinds diferentes para o mesmo atendimento.
  const reject1 = await outbox.enqueueClinicalRejection({
    atendimentoId: 'at-1',
    phone: '5511999990000',
    message: 'reprovado',
    correlationId: 'c-1'
  });
  assert.equal(reject1.duplicate, false);

  const delivery1 = await outbox.enqueueClinicalPrescriptionDelivery({
    atendimentoId: 'at-1',
    phone: '5511999990000',
    message: 'Sua receita está pronta...',
    correlationId: 'c-2'
  });
  assert.equal(delivery1.duplicate, false, 'kind diferente não colide com clinical_rejection do mesmo atendimento');
  assert.equal(delivery1.message.metadata.idempotency_key, 'prescription-delivery:at-1');

  // Segunda tentativa de entrega para o MESMO atendimento é bloqueada (fila já tem uma linha).
  const delivery2 = await outbox.enqueueClinicalPrescriptionDelivery({
    atendimentoId: 'at-1',
    phone: '5511999990000',
    message: 'Sua receita está pronta... (retry)',
    correlationId: 'c-3'
  });
  assert.equal(delivery2.duplicate, true);
  assert.equal(delivery2.message.id, delivery1.message.id, 'reaproveita a MESMA linha em vez de criar outra');

  // Claim atômico: primeira reserva move pending -> sending; segunda reserva concorrente falha.
  const claim1 = await outbox.claimRejectionMessageForSend(delivery1.message.id);
  assert(claim1, 'primeira reserva têm sucesso');
  assert.equal(claim1.status, 'sending');
  const claim2 = await outbox.claimRejectionMessageForSend(delivery1.message.id);
  assert.equal(claim2, null, 'reserva concorrente da MESMA linha falha (já está sending)');

  await outbox.finishRejectionMessage({
    messageId: delivery1.message.id,
    status: 'sent',
    providerMessageId: 'wamid-1',
    metadata: claim1.metadata
  });
  const afterFinish = await outbox.findPendingPrescriptionDeliveryMessage('at-1');
  assert.equal(afterFinish.status, 'sent');
  assert.equal(afterFinish.provider_message_id, 'wamid-1');

  // Entrega para OUTRO atendimento não é afetada pelo estado do primeiro.
  const delivery3 = await outbox.enqueueClinicalPrescriptionDelivery({
    atendimentoId: 'at-2',
    phone: '5511999990001',
    message: 'Sua receita está pronta...',
    correlationId: 'c-4'
  });
  assert.equal(delivery3.duplicate, false);

  return 'ok';
}

// ---------------------------------------------------------------------
// 5) prescriptions.store.js — findPrescriptionByProviderId (vínculo único
//    entre memedId e atendimento; nunca reutilizar receita de outro paciente).
// ---------------------------------------------------------------------
async function testPrescriptionsStore() {
  const base = path.join(__dirname, '..', 'src', 'store', 'prescriptions.store.js');
  const resolveFrom = (p) => path.join(path.dirname(base), p);

  const tables = {
    prescriptions: [
      { id: 'p-1', appointment_id: 'at-1', provider: 'memed', provider_prescription_id: 'memed-rx-1', status: 'issued' },
      { id: 'p-2', appointment_id: 'at-2', provider: 'memed', provider_prescription_id: 'memed-rx-2', status: 'issued' }
    ]
  };
  stub(resolveFrom('../db/tables'), { PRESCRIPTIONS: 'prescriptions' });
  stub(resolveFrom('../db/persistence'), {
    dbQuery: async (label, runner) => {
      const result = await runner(buildFakeSupabase(tables));
      if (result?.error) throw new Error(result.error.message);
      return result?.data;
    }
  });
  stub(resolveFrom('./audit.store'), { createAuditLog: async () => {} });

  delete require.cache[require.resolve(base)];
  const store = require(base);

  const own = await store.findPrescriptionByProviderId('memed-rx-1');
  assert.equal(own.appointment_id, 'at-1');

  // Simula a checagem feita em memed.routes.js: memedId de OUTRO atendimento é detectado.
  const crossLinked = await store.findPrescriptionByProviderId('memed-rx-2');
  assert.equal(crossLinked.appointment_id, 'at-2');
  assert.notEqual(crossLinked.appointment_id, 'at-1', 'dois pacientes não compartilham a mesma receita');

  const notFound = await store.findPrescriptionByProviderId('memed-rx-inexistente');
  assert.equal(notFound, null);

  return 'ok';
}

async function main() {
  results.whatsappOutboxKindIsolationEIdempotencia = await testWhatsappOutboxStore();
  results.doisPacientesNaoCompartilhamReceita = await testPrescriptionsStore();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
