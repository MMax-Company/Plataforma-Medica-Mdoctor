# Runbook — WhatsApp produção (rápido)

Resolução em minutos. Detalhes: `docs/OPERACAO-ASSISTIDA-WHATSAPP-EVOLUTION-N8N.md`.

---

## Healthcheck diário

```bash
# EVOLUTION_API_KEY no ambiente (Railway ou .env.evolution-staging local)
node scripts/check-production-health.js
```

Esperado: `"success": true`. Se falhar, ver seção correspondente abaixo.

---

## Reconnect QR (WhatsApp desconectado)

1. Abrir `https://evolution-api-staging-staging-40d1.up.railway.app/manager`
2. Instância **`mdoctor-staging`** → escanear QR
3. Confirmar: `connectionState` = `open`
4. `node scripts/check-production-health.js`

**Não** criar nova instância nem apagar `mdoctor-staging`.

---

## Webhook 404

| Webhook | Ação |
|---------|------|
| `evolution-webhook` | n8n → workflow **Evolution Webhook - Production** → toggle **Active** |
| `typebot-webhook` | n8n → workflow Typebot → toggle **Active** |

Ou redeploy:

```bash
cd mdoctor-backend
# N8N_API_KEY + N8N_BASE_URL
node scripts/n8n-prod-evolution-cutover.js
```

Validar:

```bash
curl -sS -o /dev/null -w "%{http_code}" -X POST \
  https://n8n-node-production-f844.up.railway.app/webhook/evolution-webhook -d '{}'
# 200
```

---

## Restart Railway

Ordem sugerida (Automation-MDoctor, production):

1. `n8n Node` — redeploy (aguardar healthy)
2. `evolution-api-staging` — redeploy
3. `mdoctor-backend-staging` — se triagem falhar

Após restart:

```bash
node scripts/check-production-health.js
node mdoctor-backend/scripts/n8n-prod-evolution-cutover.js
```

Se WhatsApp caiu para `close`/`connecting` → **Reconnect QR**.

---

## Restore workflow

Backups em `docs/backups/` (JSON sem secrets).

1. n8n UI → **Import from file** → JSON do backup
2. Ativar workflow
3. Ou: `N8N_WORKFLOW_FILE=docs/backups/YYYY-MM-DD-evolution-webhook-production.json` + deploy:

```bash
N8N_WORKFLOW_FILE=../docs/backups/<arquivo>.json \
N8N_WEBHOOK_PATH=evolution-webhook \
node mdoctor-backend/scripts/deploy-n8n-workflow.js
```

---

## Typebot 200 sem atendimento no painel

1. Railway **`n8n Node`** → conferir `BACKEND_BASE_URL` = `https://mdoctor-backend-staging-staging.up.railway.app`
2. Redeploy n8n
3. `node scripts/primeiro-teste-real-completo.js` → `atendimentoId` preenchido

---

## Troca API key (n8n 401)

1. n8n UI → **Settings → n8n API** → criar chave nova
2. Railway → serviço **`n8n Node`** → `N8N_API_KEY` → redeploy
3. Revogar chave antiga na UI
4. `node mdoctor-backend/scripts/n8n-prod-api-probe.js` → `{"status":200,"ok":true}`

`N8N_BASE_URL` deve ser só:

`https://n8n-node-production-f844.up.railway.app`

---

## Teste E2E

```bash
cd mdoctor-backend
export N8N_EVOLUTION_WEBHOOK_URL=https://n8n-node-production-f844.up.railway.app/webhook/evolution-webhook
export N8N_WEBHOOK_URL=https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook
# EVOLUTION_API_KEY se quiser provider_status completo
node scripts/e2e-evolution-n8n-typebot-staging.js
```

Esperado: `"success": true`.

Cutover completo:

```bash
node scripts/n8n-prod-evolution-cutover.js
```

---

## Mensagem real (smoke manual)

1. Enviar texto para o número conectado em `mdoctor-staging`
2. n8n → **Executions** → workflow Evolution com evento recente
3. Resposta de menu ou fluxo esperado
4. Opção médica → link Typebot (sem alterar bot publicado)

---

## O que não fazer

- Habilitar n8n/Typebot nativos no manager Evolution
- Ativar sync de histórico / gravação Message-Contact-Chat
- Commitar `.env`, `docker/n8n.env` ou API keys
- Refatorar workflows sem incidente reproduzível
