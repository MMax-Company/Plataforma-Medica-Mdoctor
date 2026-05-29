# E2E Typebot + n8n + Evolution (Staging Dry-Run)

Data/hora: 2026-05-28 23:15 -03:00

## Escopo

Validar fluxo operacional completo em staging, sem envio real:

`WhatsApp (+55 11 92638-5598) -> Evolution (mdoctor-staging) -> n8n -> Typebot bridge -> n8n -> backend -> Supabase -> painel -> delivery dry-run`

Restricoes respeitadas:

- Producao intacta
- `WHATSAPP_DRY_RUN=true` mantido
- Rate limit / idempotencia / correlation preservados
- Fallback/mock preservados
- Sem mensagem real em massa

## Componentes

| Componente | URL / ID |
| --- | --- |
| Evolution staging | `https://evolution-api-staging-staging-40d1.up.railway.app` |
| Instancia | `mdoctor-staging` |
| Numero conectado | `+55 11 92638-5598` (`5511926385598@s.whatsapp.net`) |
| n8n staging | `https://n8n-staging-staging-2dfe.up.railway.app` |
| Webhook Evolution | `POST /webhook/evolution-webhook` (+ paths by-event) |
| Webhook Typebot | `POST /webhook/typebot-webhook` |
| Backend staging | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel staging | `https://painel-medico-staging-staging.up.railway.app` |

Workflows versionados no repo:

- `docs/n8n-workflows/evolution-webhook-staging.json`
- `docs/n8n-workflows/typebot-webhook-staging.json`

Ativacao no runtime (sem secrets no repo):

```bash
N8N_WORKFLOW_FILE=docs/n8n-workflows/evolution-webhook-staging.json node mdoctor-backend/scripts/n8n-activate-workflow.js
N8N_WORKFLOW_FILE=docs/n8n-workflows/typebot-webhook-staging.json node mdoctor-backend/scripts/n8n-activate-workflow.js
```

## 1) Evolution webhook

Configuracao esperada na instancia `mdoctor-staging`:

- URL: `https://n8n-staging-staging-2dfe.up.railway.app/webhook/evolution-webhook`
- Eventos: `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `SEND_MESSAGE`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`
- `webhookByEvents=true` (paths `/messages-upsert`, etc.)

Bridge staging no n8n: mensagens inbound com keyword `STAGING_E2E_COMPLETE` sao reencaminhadas para `typebot-webhook` (Typebot public API ainda nao publicada em typebot.io).

## 2) n8n staging

| Webhook | Status validado |
| --- | --- |
| `POST /webhook/evolution-webhook` | `200` (eventos simulados) |
| `POST /webhook/typebot-webhook` | `200` |

Validacoes no workflow Evolution:

- `FLOW_ENV=staging`
- `instanceName=mdoctor-staging`
- `X-Correlation-Id` / `Idempotency-Key` propagados

Observacao: o runtime n8n pode responder `200` com corpo vazio no caller HTTP, mesmo com execucao interna OK. O script E2E resolve `atendimento` via lista autenticada quando necessario.

## 3) Backend + Evolution dry-run

`GET /api/whatsapp/provider-status` (amostra):

- `provider=evolution`
- `dryRun=true`
- `sandboxMode=true`
- `instanceFound=true`
- `instanceState=open`
- `fallbackActive=true`

Endpoints:

| Endpoint | Resultado |
| --- | --- |
| `GET /health` | `200` |
| `GET /readyz` | `200` |
| `GET /api/whatsapp/provider-status` | `200` |
| `GET /dashboard` (painel) | `200` |

## 4) Scripts E2E

| Script | Funcao |
| --- | --- |
| `mdoctor-backend/scripts/e2e-evolution-n8n-typebot-staging.js` | Eventos Evolution -> n8n + health/provider |
| `mdoctor-backend/scripts/e2e-typebot-n8n-evolution-staging.js` | Typebot-like -> n8n -> backend -> deliver dry-run |

Ultima execucao outbound (`e2e-typebot-n8n-evolution-staging.js`):

| Etapa | Resultado |
| --- | --- |
| n8n typebot webhook | `200` |
| atendimento criado (lista backend) | sim |
| approve + prescription mock | `200` / `201` mock |
| deliver | `200`, `provider=dry-run` |
| test-send burst | `400` anti-spam (esperado) |
| painel `/dashboard` | `200` |

Ultima execucao inbound simulado (`e2e-evolution-n8n-typebot-staging.js`):

| Etapa | Resultado |
| --- | --- |
| 5 eventos Evolution -> n8n | `200` cada |
| `MESSAGES_UPSERT` + `STAGING_E2E_COMPLETE` | `200` (relay interno) |

## 5) Typebot staging-safe

Arquivo: `docs/typebot/typebot-doctor-prescreve-staging-safe.json`

- Webhook aponta para n8n staging `typebot-webhook`
- Bot publico em typebot.io: **nao publicado** (`startChat` 404) — usar bridge `STAGING_E2E_COMPLETE` ou publicar bot staging antes de E2E conversacional real

## 6) Teste real WhatsApp

Nao executado nesta rodada.

- `WHATSAPP_DRY_RUN=true` preservado
- Mensagem real enviada: **nao**

## 7) Seguranca preservada

- Rate limit webhook ativo
- Anti-spam sandbox ativo
- Audit logs ativos
- Correlation/idempotency preservados
- Producao intacta
