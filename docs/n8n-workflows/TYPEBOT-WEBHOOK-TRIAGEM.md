# Typebot Webhook → Triagem (Doctor Prescreve)

## Fluxo

```
Typebot (POST)
  → n8n /webhook/typebot-webhook
  → Build Payload (paciente + triagem)
  → POST {BACKEND_BASE_URL}/api/webhook/triagem
  → Resposta JSON ao Typebot
```

## Webhook n8n

| Item | Valor |
|------|--------|
| Método | `POST` apenas (sem GET) |
| Path produção | `/webhook/typebot-webhook` |
| `responseMode` | `responseNode` |

## Backend

URL padrão (Railway produção legado):

`https://doctor-repositorio-central-production.up.railway.app/api/webhook/triagem`

Override no Docker local (`docker/n8n/.env`):

```env
BACKEND_BASE_URL=https://doctor-repositorio-central-production.up.railway.app
```

Staging Mdoctor (`mdoctor-backend-staging`) usa contrato diferente: `/api/whatsapp/webhook` — ver `N8N-WHATSAPP-STAGING-CONTRACT.md`.

**Atenção:** confirme que `BACKEND_BASE_URL` aponta para um serviço Railway **ativo**. A URL legada `doctor-repositorio-central-production` pode retornar `404 Application not found` se o app estiver desligado.

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
- `Idempotency-Key` (gerado se ausente)
- `X-N8N-Workflow: typebot-webhook-staging`

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
