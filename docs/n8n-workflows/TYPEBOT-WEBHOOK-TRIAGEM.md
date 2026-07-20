# Typebot Webhook → Triagem (Doctor Prescreve)

## Fluxo oficial (pós-consolidação WhatsApp + Typebot)

```
Meta Cloud API
  → POST /api/whatsapp/webhook (backend: menu 1/2, Typebot, suporte, upload)
Typebot (finalização)
  → n8n /webhook/typebot-webhook
  → POST {BACKEND_BASE_URL}/api/webhook/triagem
Stripe
  → POST /api/webhooks/stripe (backend — n8n NÃO confirma pagamento)
Notificações (ex.: reprovação)
  → n8n clinical-rejection-notify
  → POST /api/whatsapp/notify-text (Meta via backend)
```

## Fluxo

```
Typebot (POST)
  → n8n /webhook/typebot-webhook
  → Build Payload (paciente + triagem + Idempotency-Key estável)
  → POST {BACKEND_BASE_URL}/api/webhook/triagem
  → Resposta JSON ao Typebot
```

## Bloqueado no n8n

- `POST /api/whatsapp/support`
- `POST /api/whatsapp/process-message`
- menus iniciais / Evolution / Baileys / `TYPEBOT_PUBLIC_URL`
- confirmação por `payment_status="paid"` sem Stripe
- workflow `typebot-webhook-staging-COPIAR.json` (histórico, `active: false`)
- workflow `stripe-payment-staging.json` (stub 410, `active: false`)

## Webhook n8n

| Item | Valor |
|------|--------|
| Método | `POST` apenas (sem GET) |
| Path produção | `/webhook/typebot-webhook` |
| `responseMode` | `responseNode` |

## Backend

**Staging (validado):**

```env
BACKEND_BASE_URL=https://mdoctor-backend-staging-staging.up.railway.app
```

Rota: `POST /api/webhook/triagem` — implementada em `mdoctor-backend` (`src/routes/webhook.routes.js`).

**Produção (após deploy do mesmo código no serviço `web`):**

```env
BACKEND_BASE_URL=https://web-production-5f178.up.railway.app
```

Probe staging:

```bash
N8N_WEBHOOK_SECRET=... node mdoctor-backend/scripts/probe-triagem-webhook-staging.js
```

**Não usar** (apps Railway inexistentes): `doctor-repositorio-central-production`, `medico-prescreve-backend-production`.

O fluxo WhatsApp completo continua em `/api/whatsapp/webhook` — ver `N8N-WHATSAPP-STAGING-CONTRACT.md`.

## Deploy local

O script usa **PUT** (substituição completa de `nodes`/`connections`). **PATCH** parcial deixa o workflow antigo (`/api/whatsapp/webhook`) ativo na instância.

```powershell
# N8N_API_KEY válida em docker/n8n/.env
.\mdoctor-backend\scripts\deploy-n8n-workflow-local.ps1 `
  -WorkflowFile "docs\n8n-workflows\typebot-webhook-staging.json"
```

Se ainda aparecer URL antiga após deploy:

```powershell
$env:N8N_DEPLOY_FORCE_RECREATE = "1"
.\mdoctor-backend\scripts\deploy-n8n-workflow-local.ps1 `
  -WorkflowFile "docs\n8n-workflows\typebot-webhook-staging.json"
```

Forçar um `workflowId` específico:

```powershell
$env:N8N_WORKFLOW_ID = "uuid-do-workflow-no-n8n"
```

Reinicie o container após alterar `BACKEND_BASE_URL` no `.env`:

```powershell
cd docker\n8n
docker compose up -d
```

## Payload obrigatório

```json
{
  "paciente": {
    "nome": "...",
    "telefone": "...",
    "cpf": "...",
    "email": "..."
  },
  "triagem": {
    "doencas": "...",
    "medicacao_em_uso": "...",
    "tempo_uso": "...",
    "receita_anterior": "...",
    "sinais_alerta": "...",
    "observacoes": "..."
  }
}
```

Campos exigidos pelo backend de triagem: `paciente.nome`, `triagem.doencas`.

## Headers repassados

- `X-Correlation-Id` (gerado se ausente)
- `Idempotency-Key` estável: `typebot-result:{resultId}` → `typebot-session:{sessionId}:{phone}` → `triagem:{phone}:{cpf}` (sem `Date.now()` quando há id)
- `X-N8N-Workflow: typebot-webhook-staging`
- `X-MDoctor-Webhook-Secret`

## Respostas ao Typebot

Sucesso:

```json
{
  "success": true,
  "message": "Triagem recebida com sucesso",
  "atendimentoId": "..."
}
```

Erro:

```json
{
  "success": false,
  "message": "Erro ao processar triagem"
}
```

## Código-fonte dos nós Code

- `lib/typebot-webhook-triagem.code.js` — Build Payload
- `lib/typebot-webhook-route-response.code.js` — Route Response

Regenerar JSON:

```bash
node mdoctor-backend/scripts/build-typebot-webhook-json.js
```

## Teste manual (PowerShell)

```powershell
$body = @{
  paciente = @{
    nome = "Teste Max"
    telefone = "5511999999999"
    cpf = "00000000000"
    email = "teste@doctorprescreve.com"
  }
  triagem = @{
    doencas = "hipertensão arterial"
    medicacao_em_uso = "Losartana 50mg"
    tempo_uso = "mais de 30 dias"
    receita_anterior = "sim"
    sinais_alerta = "não"
    observacoes = "teste manual n8n local"
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method POST `
  -Uri "http://localhost:5678/webhook/typebot-webhook" `
  -ContentType "application/json" `
  -Body $body
```
