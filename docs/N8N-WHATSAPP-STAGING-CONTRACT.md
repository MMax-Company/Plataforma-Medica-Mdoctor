# N8N WhatsApp Staging Contract

## Architecture (oficial pós-consolidação)

```
Meta Cloud API → POST /api/whatsapp/webhook → backend (menu 1/2, Typebot, suporte, upload)
Typebot fim → n8n /webhook/typebot-webhook → POST /api/webhook/triagem
Stripe → POST /api/webhooks/stripe (backend; n8n não confirma pagamento)
Notificações → n8n → POST /api/whatsapp/notify-text (Meta via backend)
Entrega → n8n → POST /api/atendimentos/:id/deliver
```

**Fora do n8n:** menu 1/2, sessão Typebot, Checkout Stripe, mídia Meta, ticket de suporte.

## Scope

This document defines the formal contract between n8n and backend staging for WhatsApp triage and mock prescription delivery.

In scope:

- Typebot finalization → triagem (`POST /api/webhook/triagem`)
- Atendimento delivery trigger (`POST /api/atendimentos/:id/deliver`)
- Clinical rejection notify (`POST /api/whatsapp/notify-text`)

Out of scope / blocked in n8n:

- Menu 1/2, Typebot start, support ticket creation
- `POST /api/whatsapp/support`, `POST /api/whatsapp/process-message`
- Stripe payment confirmation / `payment_status=paid` without Stripe webhook
- Evolution / Baileys / Typebot publicUrl
- Production WhatsApp provider activation via n8n

## Environments

- Backend staging base URL: `https://mdoctor-backend-staging-staging.up.railway.app`
- Panel staging URL: `https://painel-medico-staging-staging.up.railway.app`
- n8n runtime requirement: use a dedicated **staging** n8n environment/service. Do not point production n8n to staging tests.
- WhatsApp provider status in current staging: not defined/configured yet (delivery remains controlled mock).

## Endpoints

### 1) Typebot Triagem (oficial n8n)

- Method: `POST`
- URL: `/api/webhook/triagem`
- Purpose: receive Typebot finalization payload and create/reuse atendimento
- Auth: `X-MDoctor-Webhook-Secret`
- Idempotency: `Idempotency-Key` (`typebot-result:{resultId}` preferred)

> **Nota:** `POST /api/whatsapp/webhook` é exclusivo da **Meta Cloud API** (menu/sessão/Typebot/suporte/upload). Não usar n8n para menu ou suporte.

### 1b) Legacy WhatsApp Triage Webhook (não usar para Typebot)

- Method: `POST`
- URL: `/api/whatsapp/webhook`
- Purpose: Meta Cloud API inbound only
- n8n: **não** criar atendimento clínico por esta rota a partir do Typebot

#### Request body (expected from n8n) — LEGADO, não usar para Typebot

```json
{
  "from": "+5511999999999",
  "text": "renovar receita hipertensao",
  "rawMessage": {
    "provider": "n8n",
    "messageId": "wamid.HBgL...",
    "timestamp": "2026-05-28T09:00:00.000Z",
    "channel": "whatsapp"
  }
}
```

#### Success response (shape)

```json
{
  "success": true,
  "reply": "Recebemos seus dados. Sua solicitação entrou na fila médica para análise.",
  "patient": {},
  "atendimento": {
    "id": "uuid",
    "status": "waiting"
  },
  "decision": {
    "eligible": true,
    "reason": "..."
  }
}
```

### 2) Atendimento Delivery (Mock)

- Method: `POST`
- URL: `/api/atendimentos/:id/deliver`
- Purpose: mark delivery event and move atendimento to delivered state using mock channel behavior
- Auth: Bearer JWT (medical backend auth)

#### Request body

```json
{
  "channel": "whatsapp"
}
```

#### Success response (shape)

```json
{
  "success": true,
  "atendimento": {
    "id": "uuid",
    "status": "delivered"
  },
  "delivery": {
    "id": "delivery-mock-...",
    "channel": "whatsapp",
    "provider": "mock",
    "status": "sent"
  }
}
```

### 3) WhatsApp Status

- Method: `GET`
- URL: `/api/whatsapp/status`
- Purpose: operational state for whatsapp feature flag in staging

#### Success response (shape)

```json
{
  "success": true,
  "enabled": false,
  "mode": "development"
}
```

## Recommended Headers

For n8n -> webhook requests:

- `Content-Type: application/json`
- `X-Correlation-Id: <uuid-v4>`
- `Idempotency-Key: <provider-message-id-or-uuid>` (preferred by backend)
- `X-Idempotency-Key: <provider-message-id-or-uuid>` (accepted by n8n flow conventions)
- `X-N8N-Workflow: <workflow-name-or-id>`

For authenticated backend actions:

- `Authorization: Bearer <jwt-token>`
- `Content-Type: application/json`
- `X-Correlation-Id: <uuid-v4>`

## Webhook Authentication (current behavior)

Backend webhook now supports shared-secret header auth:

- Header: `X-MDoctor-Webhook-Secret`
- Backend env: `N8N_WEBHOOK_SECRET`

Rules:

- If `N8N_WEBHOOK_SECRET` is configured, webhook requests must provide the exact header value.
- Missing/invalid header returns `401`.
- If the secret is not configured and backend is not production, webhook is allowed with controlled warning log.
- Secret value is never logged.

## Proposed Signature Hardening (next step)

Recommended additional controls for future hardening:

1. Add `X-Webhook-Signature` using HMAC SHA-256 over raw body
2. Add `X-Webhook-Timestamp` and reject stale requests (> 5 minutes) at gateway layer
3. Restrict ingress source by allowlist/IP or trusted proxy

## Idempotency

n8n must enforce idempotency with `X-Idempotency-Key`:

- Primary key suggestion: provider `messageId`
- Fallback: deterministic hash of `from + text + timestamp`

n8n behavior:

- If duplicate key within 24h window: do not call webhook again
- Store last backend response for replay-safe behavior

Backend webhook behavior (staging):

- Reads idempotency identifier in this order:
  1. `Idempotency-Key` header
  2. `rawMessage.messageId`
- If already processed, returns `200` with known result and `duplicate: true`.
- On duplicate, no new atendimento is created.
- Audit log action: `webhook_duplicate_ignored`.
- Memory cache safety:
  - TTL-based cleanup via `WEBHOOK_IDEMPOTENCY_TTL_MS`
  - Max entries cap via `WEBHOOK_IDEMPOTENCY_MAX_ENTRIES`
  - Periodic cleanup to avoid unbounded growth

## Correlation

Use one correlation id per business event and propagate:

- n8n inbound trigger
- backend webhook call
- downstream status/delivery calls
- n8n logs and error notifications

Suggested format: UUID v4 in `X-Correlation-Id`.

Backend behavior (staging):

- Accepts `X-Correlation-Id` when provided.
- If missing, backend auto-generates a UUID and returns it in `X-Correlation-Id` response header.
- Correlation id is propagated in:
  - webhook response body (`correlationId`)
  - related `audit_logs` payloads
  - delivery (`POST /api/atendimentos/:id/deliver`) response body
  - prescriptions endpoints (`/api/prescriptions/:id` and `/api/prescriptions/:id/generate`) response body
  - backend structured request logs (`http_request`)

## Retry Policy

For `POST /api/whatsapp/webhook` and `POST /api/atendimentos/:id/deliver`:

- Retry on: `408`, `429`, `5xx`, network timeout
- Do not retry on: `400`, `401`, `403`, `404`
- Backoff: exponential (`2s`, `5s`, `15s`)
- Max attempts: `3`
- Use same `X-Idempotency-Key` across retries

## Webhook Rate Limit (staging)

Endpoint protected:

- `POST /api/whatsapp/webhook`

Policy:

- IP-based rate limit
- Default max: `20` requests
- Default window: `60s`
- Env controls:
  - `WEBHOOK_RATE_LIMIT_MAX`
  - `WEBHOOK_RATE_LIMIT_WINDOW_MS`
  - `RATE_LIMIT_MAX_BUCKETS`

When exceeded:

- HTTP `429`
- Controlled message: `Webhook temporariamente limitado. Tente novamente em instantes.`
- Audit log action: `webhook_rate_limited`

## Error Handling

Expected classes:

- `400`: malformed payload (`from` missing, invalid JSON)
- `401/403`: auth or permission issue
- `404`: atendimento not found (delivery endpoint)
- `5xx`: transient backend issue

n8n should:

- log request/response with redaction
- include correlation id in alerts
- route hard failures to dead-letter queue/manual review

## Separation of Concerns

### WhatsApp Triage

- Input normalization
- Eligibility decision trigger
- Queue entry (`waiting`)

### Prescription Delivery

- Controlled delivery transition to `delivered`
- Mock provider in this phase only

### Atendimento Status

- Managed by backend clinical workflow endpoints

### Payments/Stripe

- Explicitly out of scope in this phase
- No Stripe dependency for webhook acceptance or delivery mock

## Current Staging Validation Snapshot

Validated and operational in staging:

- `GET /api/whatsapp/status`
- `POST /api/whatsapp/webhook`
- `POST /api/atendimentos/:id/deliver` (`channel=whatsapp`, provider `mock`)

Safety status:

- fallback/mock preserved
- no production changes
- no Stripe/payment activation
