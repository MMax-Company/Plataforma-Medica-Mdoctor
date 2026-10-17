// ETAPA 2 (rotas) — testes HTTP reais (express + http, sem supertest) das
// rotas /api/admin/support/*: prova que médico/anônimo não acessam, que
// admin/administrativo acessam, que a posse do lock é validada no servidor
// (não na interface) e que a flag SUPPORT_CHAT_UI_ENABLED esconde o recurso
// quando desligada. Stub de Supabase pela mesma técnica de require.cache
// usada em ETAPA 1/2 — sem rede/banco real (só o servidor HTTP local desta
// própria rota, em localhost).
const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const express = require('express');
const { FakeSupabaseClient } = require('./_fakes/fake-supabase-client');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_support_chat_authz';

function stub(relativePath, exports) {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const storePath = path.join(__dirname, '..', 'src', 'store', 'support-chat.store.js');
const resolveFrom = (p) => path.join(path.dirname(storePath), p);

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

const servicePath = path.join(__dirname, '..', 'src', 'services', 'support-chat.service.js');
const resolveFromService = (p) => path.join(path.dirname(servicePath), p);

// Envio humano (rota POST /conversations/:id/messages): stubs mínimos para a
// rota conseguir ser exercitada via HTTP sem rede real — mesma garantia de
// test-support-chat-send.js, aqui só para o teste de wiring HTTP (flag
// 503 por padrão + caminho feliz ponta a ponta pela rota).
const atendimentosFixture = { 'appt-authz-send': { id: 'appt-authz-send', paciente_telefone: '5511999990099' } };
stub(resolveFromService('../store/atendimentos.store'), {
  getAtendimento: async (id) => atendimentosFixture[id] || null
});
const metaProviderCalls = [];
stub(resolveFromService('./providers/meta.provider'), {
  sendTextMessage: async ({ to, text }) => {
    metaProviderCalls.push({ to, text });
    return { provider: 'meta', providerMessageId: `wamid-authz-${metaProviderCalls.length}`, providerStatus: 'sent', raw: {} };
  }
});

const supportChatRoutes = require('../src/routes/support-chat.routes');
const store = require(storePath);

function token(role, sub = 'user-1') {
  return jwt.sign({ sub, role }, process.env.JWT_SECRET);
}

function setFlags({ ui = false, agentSend = false } = {}) {
  process.env.SUPPORT_CHAT_UI_ENABLED = ui ? 'true' : 'false';
  process.env.SUPPORT_CHAT_AGENT_SEND_ENABLED = agentSend ? 'true' : 'false';
}

async function request(server, method, urlPath, { authToken, body } = {}) {
  const { port } = server.address();
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

const results = {};

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/support', supportChatRoutes);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    // Seed: conversation existente para os testes de leitura/claim.
    const { conversation } = await store.ensureConversationForAppointment({ appointmentId: 'appt-authz-1', patientId: 'pat-1' });

    // 1) Sem token -> 401, nunca chega no service/flag check.
    {
      setFlags({ ui: true });
      const res = await request(server, 'GET', '/api/admin/support/conversations');
      assert.equal(res.status, 401);
      results.semTokenRecebe401 = 'ok';
    }

    // 2) Token válido mas papel "doctor" (não administrativo) -> 403.
    {
      const res = await request(server, 'GET', '/api/admin/support/conversations', { authToken: token('doctor') });
      assert.equal(res.status, 403);
      results.papelMedicoRecebe403 = 'ok';
    }

    // 3) Token com role inexistente/anônimo forjado sem role -> 403.
    {
      const res = await request(server, 'GET', '/api/admin/support/conversations', { authToken: token(undefined) });
      assert.equal(res.status, 403);
      results.semRoleRecebe403 = 'ok';
    }

    // 4) admin e administrativo autenticados, mas feature flags desligadas
    //    (estado de fábrica) -> 503, recurso efetivamente escondido.
    {
      setFlags({ ui: false });
      const resAdmin = await request(server, 'GET', '/api/admin/support/conversations', { authToken: token('admin') });
      const resAdministrativo = await request(server, 'GET', '/api/admin/support/conversations', { authToken: token('administrativo') });
      assert.equal(resAdmin.status, 503);
      assert.equal(resAdmin.body.code, 'SUPPORT_CHAT_DISABLED');
      assert.equal(resAdministrativo.status, 503);
      results.flagsDesligadasRetornam503ParaAdminAutenticado = 'ok';
    }

    // 5) Com as flags ligadas, admin autenticado consegue listar e abrir a
    //    conversation semeada.
    {
      setFlags({ ui: true });
      const list = await request(server, 'GET', '/api/admin/support/conversations', { authToken: token('admin') });
      assert.equal(list.status, 200);
      assert.ok(list.body.conversations.some((c) => c.id === conversation.id));

      const detail = await request(server, 'GET', `/api/admin/support/conversations/${conversation.id}`, { authToken: token('administrativo') });
      assert.equal(detail.status, 200);
      assert.equal(detail.body.conversation.id, conversation.id);
      assert.ok(Array.isArray(detail.body.messages));
      results.comFlagsLigadasAdminListaEAbreConversation = 'ok';
    }

    // 6) Posse validada no servidor: admin-A reivindica; admin-B não
    //    consegue reivindicar nem liberar o lock de admin-A pela rota.
    {
      const claimA = await request(server, 'POST', `/api/admin/support/conversations/${conversation.id}/claim`, { authToken: token('admin', 'admin-A') });
      assert.equal(claimA.status, 200);
      assert.equal(claimA.body.conversation.locked_by, 'admin-A');

      const claimB = await request(server, 'POST', `/api/admin/support/conversations/${conversation.id}/claim`, { authToken: token('administrativo', 'admin-B') });
      assert.equal(claimB.status, 409);
      assert.equal(claimB.body.reason, 'locked_by_other');

      const releaseB = await request(server, 'POST', `/api/admin/support/conversations/${conversation.id}/release`, { authToken: token('administrativo', 'admin-B') });
      assert.equal(releaseB.status, 409);

      const releaseA = await request(server, 'POST', `/api/admin/support/conversations/${conversation.id}/release`, { authToken: token('admin', 'admin-A') });
      assert.equal(releaseA.status, 200);
      assert.equal(releaseA.body.conversation.locked_by, null);
      results.posseDoLockValidadaNoServidorViaHttp = 'ok';
    }

    // 7) Voltar a desligar as flags esconde o recurso de novo, mesmo para o
    //    mesmo admin que acabou de usá-lo — confirma reversibilidade.
    {
      setFlags({ ui: false });
      const res = await request(server, 'GET', `/api/admin/support/conversations/${conversation.id}`, { authToken: token('admin', 'admin-A') });
      assert.equal(res.status, 503);
      results.desligarFlagsVoltaEscondeORecursoParaMesmoAdmin = 'ok';
    }

    // 8) Envio humano com SUPPORT_CHAT_AGENT_SEND_ENABLED desligada (padrão
    //    de fábrica, mesmo com SUPPORT_CHAT_UI_ENABLED ligada) -> 503
    //    explícito, nunca chega a validar lock/janela nem chama o provider.
    {
      setFlags({ ui: true, agentSend: false });
      const before = metaProviderCalls.length;
      const res = await request(server, 'POST', `/api/admin/support/conversations/${conversation.id}/messages`, {
        authToken: token('admin', 'admin-A'),
        body: { text: 'oi', clientMessageId: 'authz-send-flag-off' }
      });
      assert.equal(res.status, 503);
      assert.equal(res.body.code, 'SUPPORT_CHAT_AGENT_SEND_DISABLED');
      assert.equal(metaProviderCalls.length, before);
      results.envioHumanoComFlagDesligadaRetorna503SemChamarProvider = 'ok';
    }

    // 9) Caminho feliz ponta a ponta pela rota HTTP: com as duas flags
    //    ligadas, lock do próprio ator e dentro da janela de 24h, o envio é
    //    aceito e a mensagem persistida reflete na resposta HTTP.
    {
      setFlags({ ui: true, agentSend: true });
      const seed = await store.ensureConversationForAppointment({ appointmentId: 'appt-authz-send', patientId: 'pat-authz-send' });
      await store.claimConversation({ conversationId: seed.conversation.id, actorId: 'admin-A' });
      await store.recordMessage({ conversationId: seed.conversation.id, direction: 'inbound', body: 'oi', sender: 'patient' });

      const before = metaProviderCalls.length;
      const res = await request(server, 'POST', `/api/admin/support/conversations/${seed.conversation.id}/messages`, {
        authToken: token('admin', 'admin-A'),
        body: { text: 'Olá! Recebemos sua mensagem.', clientMessageId: 'authz-send-ok-1' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.duplicate, false);
      assert.equal(res.body.message.direction, 'outbound');
      assert.equal(metaProviderCalls.length, before + 1);
      results.envioHumanoComFlagsLigadasLockEJanelaOkFuncionaPontaAPontaViaHttp = 'ok';
    }

    console.log(JSON.stringify(results, null, 2));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((e) => {
  console.error('FALHOU:', e.message, e.stack);
  process.exit(1);
});
