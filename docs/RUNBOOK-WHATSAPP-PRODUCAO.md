# Runbook — WhatsApp produção (rápido)

Resolução em minutos. Provider ativo: **Meta WhatsApp Cloud API**
(`WHATSAPP_PROVIDER=meta`, envio em `mdoctor-backend/src/services/providers/meta.provider.js`,
webhook inbound em `mdoctor-backend/src/routes/whatsapp.routes.js`).

---

## Healthcheck diário

```bash
node scripts/check-production-health.js
```

Esperado: `"success": true`. Se falhar, ver seção correspondente abaixo.

Status do provider (config + partes configuradas):

```text
GET {BACKEND}/api/whatsapp/provider-status
```

---

## Webhook 404 (n8n)

| Webhook | Ação |
|---------|------|
| `typebot-webhook` | n8n → workflow Typebot → toggle **Active** |

Validar:

```bash
curl -sS -o /dev/null -w "%{http_code}" -X POST \
  https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook -d '{}'
# 200
```

---

## Webhook Meta sem eventos

1. Meta App Dashboard → WhatsApp → Configuration → conferir Callback URL e
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (mesmo valor no Railway backend)
2. Conferir assinatura dos campos (`messages`) no webhook subscription
3. Railway backend → logs: procurar `whatsapp_webhook` no deploy ativo

---

## Restart Railway

Ordem sugerida (Automation-MDoctor, production):

1. `n8n Node` — redeploy (aguardar healthy)
2. `mdoctor-backend-staging` — se triagem falhar

Após restart:

```bash
node scripts/check-production-health.js
```

---

## Restore workflow

Backups em `docs/backups/` (JSON sem secrets).

1. n8n UI → **Import from file** → JSON do backup
2. Ativar workflow

---

## Typebot 200 sem atendimento no painel

1. Railway **`n8n Node`** → conferir `BACKEND_BASE_URL` = `https://mdoctor-backend-staging-staging.up.railway.app`
2. Redeploy n8n
3. Reexecutar o fluxo do Typebot e conferir `atendimentoId` no painel

---

## Troca API key (n8n 401)

1. n8n UI → **Settings → n8n API** → criar chave nova
2. Railway → serviço **`n8n Node`** → `N8N_API_KEY` → redeploy
3. Revogar chave antiga na UI
4. `node mdoctor-backend/scripts/n8n-prod-api-probe.js` → `{"status":200,"ok":true}`

`N8N_BASE_URL` deve ser só:

`https://n8n-node-production-f844.up.railway.app`

---

## Mensagem real (smoke manual)

1. Enviar texto para o número WhatsApp Business conectado à Cloud API
2. Backend → logs: evento inbound processado (rota `whatsapp.routes.js`)
3. Resposta de menu ou fluxo esperado
4. Opção médica → link Typebot (sem alterar bot publicado)

---

## O que não fazer

- Alterar configuração do app Meta (Embedded Signup/Coexistence) sem solicitação explícita
- Commitar `.env`, `docker/n8n.env`, tokens da Meta ou API keys
- Refatorar workflows sem incidente reproduzível
