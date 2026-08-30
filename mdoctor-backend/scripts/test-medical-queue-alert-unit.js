// Teste isolado (sem rede, sem banco) do ponto ÚNICO de disparo do alerta
// "novo paciente na fila médica" — announceMedicalQueueEntryOnce em
// atendimentos.store.js. Idempotência por dados_clinicos.medical_queue_alert_sent_at.
const assert = require('assert');
const path = require('path');

function stub(relativeTo, relativePath, exports) {
  const resolved = require.resolve(path.join(path.dirname(relativeTo), relativePath));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const storePath = require.resolve('../src/store/atendimentos.store.js');

// --- estado de teste ---
let alerts = [];
let markerWrites = [];
let visible = true;
let currentRow = null; // o que getAtendimento (releitura) devolve

// fake supabase encadeável: cobre select().eq().maybeSingle() (leitura) e
// update().eq().select().maybeSingle() (gravação do marcador)
let channelsConfigured = true;
let markerAlreadySet = false; // simula corrida: write condicional não casa linha

function fakeSupabase() {
  return {
    from: () => {
      const chain = {
        _op: 'select',
        _patch: null,
        select: () => chain,
        update: (patch) => { chain._op = 'update'; chain._patch = patch; return chain; },
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => {
          if (chain._op === 'update') {
            if (markerAlreadySet) return null; // filtro .is(...null) não casou
            markerWrites.push(chain._patch);
            return { id: 'atd-1' };
          }
          return currentRow;
        },
        single: async () => currentRow
      };
      return chain;
    }
  };
}

stub(storePath, '../db/persistence', { dbQuery: async (_label, fn) => fn(fakeSupabase()) });
stub(storePath, '../db/resolve-tables', { getAppointmentTable: async () => 'atendimentos' });
stub(storePath, '../services/clinical-payload-normalizer.service', {
  isVisibleInMedicalPanel: () => visible
});
stub(storePath, '../services/admin-alert.service', {
  notifyAdminAlert: async (payload) => { alerts.push(payload); return { whatsapp: 'sent', telegram: 'skipped', delivered: true }; },
  adminAlertChannelsConfigured: () => channelsConfigured
});
stub(storePath, '../config/logger', { info: () => {}, warn: () => {}, error: () => {} });

const { announceMedicalQueueEntryOnce } = require('../src/store/atendimentos.store.js');

const PHOTO = 'https://x/y/foto-receita.jpg';

// Monta o atendimento passado ao hook E o currentRow (o que a releitura devolve).
function arm({ status = 'waiting', clinical = { previous_prescription_url: PHOTO }, rowClinical } = {}) {
  currentRow = {
    id: 'atd-1',
    status,
    paciente_nome: 'Paciente Teste',
    dados_clinicos: rowClinical || clinical
  };
  return {
    id: 'atd-1',
    status,
    pagamento_status: 'CONFIRMADO',
    elegibilidade: { eligible: true },
    condicao: 'dislipidemia',
    dados_clinicos: clinical
  };
}

function reset() {
  alerts = []; markerWrites = []; visible = true; currentRow = null;
  channelsConfigured = true; markerAlreadySet = false;
}

async function main() {
  const results = {};

  // 1) waiting + visível -> 1 alerta + marcador gravado
  reset();
  await announceMedicalQueueEntryOnce(arm());
  assert.equal(alerts.length, 1, 'dispara 1 alerta');
  assert.equal(alerts[0].type, 'medical_queue');
  assert.equal(alerts[0].id, 'atd-1');
  assert.equal(markerWrites.length, 1, 'grava o marcador');
  assert.ok(markerWrites[0].dados_clinicos.medical_queue_alert_sent_at, 'marcador com timestamp');
  results.waitingVisivel_disparaUmaVez = 'ok';

  // 2) marcador já no objeto -> 0 alerta (retry / webhook repetido / upload repetido)
  reset();
  await announceMedicalQueueEntryOnce(arm({
    clinical: { previous_prescription_url: PHOTO, medical_queue_alert_sent_at: '2026-08-30T00:00:00Z' }
  }));
  assert.equal(alerts.length, 0, 'não redispara com marcador presente no objeto');
  assert.equal(markerWrites.length, 0);
  results.marcadorNoObjeto_naoRedispara = 'ok';

  // 2b) marcador só na releitura (corrida: outra execução gravou primeiro) -> 0 alerta
  reset();
  await announceMedicalQueueEntryOnce(arm({
    clinical: { previous_prescription_url: PHOTO },
    rowClinical: { previous_prescription_url: PHOTO, medical_queue_alert_sent_at: '2026-08-30T00:00:00Z' }
  }));
  assert.equal(alerts.length, 0, 'corrida: releitura acha o marcador, não notifica');
  results.marcadorNaReleitura_naoNotifica = 'ok';

  // 2c) write condicional não casa linha (outra execução gravou entre releitura e write) -> 0 alerta
  reset();
  markerAlreadySet = true;
  await announceMedicalQueueEntryOnce(arm());
  assert.equal(alerts.length, 0, 'corrida no write condicional: claimed=false, não notifica');
  results.writeCondicionalPerdeCorrida_naoNotifica = 'ok';

  // 2d) nenhum canal configurado -> 0 alerta, 0 marcador (retenta na próxima transição)
  reset();
  channelsConfigured = false;
  await announceMedicalQueueEntryOnce(arm());
  assert.equal(alerts.length, 0, 'sem canal: não notifica');
  assert.equal(markerWrites.length, 0, 'sem canal: NÃO marca (permite retry futuro)');
  results.semCanalConfigurado_naoMarca = 'ok';

  // 3) waiting mas NÃO visível (sem foto ainda) -> 0 alerta
  reset();
  visible = false;
  await announceMedicalQueueEntryOnce(arm({ clinical: {} }));
  assert.equal(alerts.length, 0, 'sem visibilidade no painel: não dispara');
  assert.equal(markerWrites.length, 0);
  results.waitingNaoVisivel_naoDispara = 'ok';

  // 4) status != waiting -> 0 alerta
  reset();
  await announceMedicalQueueEntryOnce(arm({ status: 'em_atendimento' }));
  assert.equal(alerts.length, 0);
  results.statusNaoWaiting_naoDispara = 'ok';

  // 5) flapping: waiting -> em_atendimento -> waiting -> 0 alerta extra
  reset();
  await announceMedicalQueueEntryOnce(arm());                          // 1º waiting: dispara
  const marker = markerWrites[0].dados_clinicos.medical_queue_alert_sent_at;
  const clinicalComMarcador = { previous_prescription_url: PHOTO, medical_queue_alert_sent_at: marker };
  await announceMedicalQueueEntryOnce(arm({ status: 'em_atendimento', clinical: clinicalComMarcador }));
  await announceMedicalQueueEntryOnce(arm({ status: 'waiting', clinical: clinicalComMarcador }));
  assert.equal(alerts.length, 1, 'flapping de status não gera alerta extra');
  results.flappingStatus_semAlertaExtra = 'ok';

  // 6) notifyAdminAlert lançando -> announce não propaga (nunca trava criação/status)
  reset();
  const stubbed = require.cache[require.resolve(path.join(path.dirname(storePath), '../services/admin-alert.service'))].exports;
  const original = stubbed.notifyAdminAlert;
  stubbed.notifyAdminAlert = async () => { throw new Error('canal fora do ar'); };
  await announceMedicalQueueEntryOnce(arm()); // não deve lançar
  stubbed.notifyAdminAlert = original;
  results.falhaNoAlerta_naoPropaga = 'ok';

  // 7) sem id -> no-op
  reset();
  await announceMedicalQueueEntryOnce({ status: 'waiting' });
  assert.equal(alerts.length, 0);
  results.semId_noop = 'ok';

  console.log(JSON.stringify(results, null, 2));
  const falhas = Object.entries(results).filter(([, v]) => v !== 'ok');
  if (falhas.length) { console.error('FALHAS:', falhas); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
