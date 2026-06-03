# Operação assistida — WhatsApp / Evolution / n8n

Guia operacional do fluxo WhatsApp ponta a ponta do Doctor Prescreve (modo discreto, produção assistida).

**Última validação:** 2026-06-03 — API n8n 200, webhooks Evolution/Typebot 200, E2E Evolution → n8n OK.

---

## 1. Arquitetura final

```text
Paciente (WhatsApp)
  → Evolution API (instância mdoctor-staging, staging Railway)
  → POST webhook por evento
  → n8n produção (/webhook/evolution-webhook)
       ├─ menu / suporte / relay E2E (Code)
       └─ STAGING_E2E_COMPLETE → /webhook/typebot-webhook
  → Typebot publicado (doctor-prescreve-8rmljgu)
  → n8n (/webhook/typebot-webhook)
  → POST /api/webhook/triagem (backend staging)
  → fila médica / painel
```

**Princípios:**

- Ponte WhatsApp via **n8n externo** (não usar módulos nativos n8n/Typebot no manager Evolution).
- **Modo discreto:** Evolution não persiste mensagens/contatos/chats/histórico no Postgres.
- **Produção assistida:** `FLOW_ENV=staging` no n8n produção alinha validações do workflow Evolution com o ambiente de homologação.

---

## 2. URLs de produção / staging operacional

| Componente | URL |
|------------|-----|
| Evolution API (staging) | `https://evolution-api-staging-staging-40d1.up.railway.app` |
| Manager Evolution | `…/manager` (QR / reconnect) |
| Instância | **`mdoctor-staging`** (não recriar sem runbook) |
| n8n produção | `https://n8n-node-production-f844.up.railway.app` |
| Webhook Evolution | `…/webhook/evolution-webhook` |
| Webhook Typebot | `…/webhook/typebot-webhook` |
| Typebot paciente | `https://typebot.co/doctor-prescreve-8rmljgu` |
| Backend staging | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel staging | `https://painel-medico-staging-staging.up.railway.app` |

**Railway — `N8N_BASE_URL` (serviço `n8n Node`):**

```text
https://n8n-node-production-f844.up.railway.app
```

Não usar URL de editor (`/workflow/...`) como base da API.

---

## 3. Variáveis obrigatórias (Railway / runtime)

Definir apenas no Railway ou `.env` local gitignored — **nunca commitar valores reais**.

### Evolution (`evolution-api-staging`)

| Variável | Uso |
|----------|-----|
| `AUTHENTICATION_API_KEY` | API Evolution |
| `SERVER_URL` | URL pública do serviço |
| `DATABASE_CONNECTION_CLIENT_NAME` | Alinhar com Postgres (`evolution_exchange`) |
| `WEBHOOK_GLOBAL_ENABLED` | `true` |
| `WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS` | `true` |
| `N8N_ENABLED` | **`false`** |
| `TYPEBOT_ENABLED` | **`false`** |
| `DATABASE_SAVE_DATA_NEW_MESSAGE` | **`false`** |
| `DATABASE_SAVE_DATA_CONTACTS` | **`false`** |
| `DATABASE_SAVE_DATA_CHATS` | **`false`** |
| `DATABASE_SAVE_DATA_HISTORIC` | **`false`** |

### n8n produção (`n8n Node`)

| Variável | Uso |
|----------|-----|
| `N8N_BASE_URL` | Base da Public API (sem `/workflow/…`) |
| `N8N_API_KEY` | Header `X-N8N-API-KEY` |
| `FLOW_ENV` | `staging` (workflow Evolution) |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` / `EVOLUTION_INSTANCE` | Outbound menu |
| `BACKEND_URL_STAGING` | Suporte / APIs backend |
| `N8N_TYPEBOT_WEBHOOK_URL` | Relay para Typebot |
| `N8N_WEBHOOK_SECRET` | Chamadas ao backend |
| `TYPEBOT_PUBLIC_ID` / `TYPEBOT_PUBLIC_URL` | Links no menu |

### Backend staging

| Variável | Uso |
|----------|-----|
| `WHATSAPP_PROVIDER` | `evolution` quando envio real |
| `EVOLUTION_*` | Provider Evolution |
| `N8N_WEBHOOK_SECRET` | Validação webhooks n8n → backend |

---

## 4. Workflows versionados

| Arquivo | n8n | Webhook |
|---------|-----|---------|
| `docs/n8n-workflows/evolution-webhook-staging.json` | Evolution Webhook - Production | `evolution-webhook` |
| `docs/n8n-workflows/typebot-webhook-staging.json` | (Typebot produção) | `typebot-webhook` |

Deploy Evolution (após `N8N_API_KEY` válida):

```bash
cd mdoctor-backend
# N8N_BASE_URL e N8N_API_KEY no ambiente (Railway ou shell)
node scripts/validate-evolution-webhook-json.js
node scripts/n8n-prod-evolution-cutover.js
```

Validação só da API:

```bash
node scripts/n8n-prod-api-probe.js
# esperado: {"status":200,"ok":true}
```

---

## 5. Validar webhooks (rápido)

Substituir `$N8N` pela base de produção.

```bash
# Evolution — esperado HTTP 200 (corpo pode ser IGNORED em POST vazio)
curl -sS -o /dev/null -w "%{http_code}" -X POST "$N8N/webhook/evolution-webhook" \
  -H "Content-Type: application/json" -d '{}'

# Typebot bridge — esperado HTTP 200
curl -sS -o /dev/null -w "%{http_code}" -X POST "$N8N/webhook/typebot-webhook" \
  -H "Content-Type: application/json" -d '{}'
```

Instância Evolution (com apikey no ambiente):

```bash
curl -sS -H "apikey: $EVOLUTION_API_KEY" \
  "$EVOLUTION_API_URL/webhook/find/mdoctor-staging"
```

URL esperada: `…/webhook/evolution-webhook` (base n8n produção).

---

## 6. Teste E2E automatizado

```bash
cd mdoctor-backend
# EVOLUTION_API_KEY, opcionalmente N8N_API_KEY para cutover completo
node scripts/e2e-evolution-n8n-typebot-staging.js
```

Variáveis para apontar n8n produção:

```bash
export N8N_EVOLUTION_WEBHOOK_URL=https://n8n-node-production-f844.up.railway.app/webhook/evolution-webhook
export N8N_WEBHOOK_URL=https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook
```

Esperado: `"success": true` e status 200 em todos os passos `n8n_evolution_*`.

Cutover completo (API + deploy + webhooks + E2E):

```bash
node scripts/n8n-prod-evolution-cutover.js
```

---

## 7. Reconnect WhatsApp

1. Abrir manager: `https://evolution-api-staging-staging-40d1.up.railway.app/manager`
2. Selecionar **`mdoctor-staging`** (não criar instância paralela).
3. Se `close` / `connecting`: escanear QR com o número autorizado.
4. Confirmar:

```bash
curl -sS -H "apikey: $EVOLUTION_API_KEY" \
  "$EVOLUTION_API_URL/instance/connectionState/mdoctor-staging"
# state: open
```

5. Enviar mensagem de teste; conferir execução no n8n (Executions) sem reativar sync de histórico.

---

## 8. Modo discreto (manutenção)

**Manter no Railway Evolution:**

- Salvamento de Message/Contact/Chat/Histórico = **off**
- `syncFullHistory=false` na config da instância (via script ou API)
- Contagens `_count` em `fetchInstances` próximas de zero após operação normal

**Não ativar no manager Evolution:**

- Integração nativa **n8n**
- Integração nativa **Typebot**
- Sync completo de histórico
- Armazenamento desnecessário de mídia/contatos

Detalhes e incidentes: `docs/EVOLUTION-API-STAGING.md`.

---

## 9. Rollback básico

| Cenário | Ação |
|---------|------|
| Webhook Evolution 404 | Ativar workflow **Evolution Webhook - Production** no n8n ou `n8n-prod-evolution-cutover.js` |
| API n8n 401 | Rotacionar chave em Settings → n8n API; atualizar `N8N_API_KEY` no Railway; redeploy |
| WhatsApp desconectado | QR no manager; **não** apagar instância |
| Menu não responde | Verificar `EVOLUTION_API_KEY` no n8n; logs da execução Evolution |
| Triagem não entra | Validar `typebot-webhook` 200 e `N8N_WEBHOOK_SECRET` |
| Reverter deploy workflow | Desativar workflow no n8n UI; restaurar JSON anterior do repo e redeploy |

---

## 10. Checklist de produção assistida

Marque antes de operação com pacientes reais:

- [ ] Evolution `mdoctor-staging` = **open**
- [ ] `POST /webhook/evolution-webhook` = **200**
- [ ] `POST /webhook/typebot-webhook` = **200**
- [ ] Typebot `doctor-prescreve-8rmljgu` publicado (sem alterar bot)
- [ ] Backend staging `/health` e `/readyz` = **200**
- [ ] Postgres Evolution + Redis = OK (Railway healthy)
- [ ] Modo discreto ativo (flags DATABASE_SAVE_* = false)
- [ ] Sem sync de histórico / sem gravação contatos-chats-mensagens
- [ ] `N8N_ENABLED=false` e `TYPEBOT_ENABLED=false` na Evolution
- [ ] `N8N_BASE_URL` = base da API (sem path `/workflow/…`)
- [ ] Logs e repo **sem** API keys / tokens / `.env` commitados
- [ ] Chaves antigas de troubleshooting **revogadas** no n8n UI
- [ ] E2E `e2e-evolution-n8n-typebot-staging.js` ou `n8n-prod-evolution-cutover.js` = success

---

## 11. Segurança

| Item | Onde deve estar |
|------|-----------------|
| `N8N_API_KEY` | Railway `n8n Node` apenas |
| `EVOLUTION_API_KEY` | Railway Evolution + runtime local gitignored |
| `.env` / `docker/n8n.env` | **Gitignored** — usar `.env.example` |
| Rotação | Após exposição em troubleshooting: nova chave n8n UI → Railway → revogar antiga |

Arquivo local `docker/n8n.env` contém segredos — **não commitar** (ver `.gitignore`).

---

## 12. Referências

- `docs/EVOLUTION-API-STAGING.md` — Evolution, discreto, incidentes
- `docs/OPERACAO-ASSISTIDA-GUIDE.md` — fluxo médico / painel
- `docs/n8n-workflows/TYPEBOT-WEBHOOK-TRIAGEM.md` — triagem Typebot
- Commit deploy n8n: `d5b2678` — validação por tipo de workflow
