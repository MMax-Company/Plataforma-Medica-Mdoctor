# n8n Workflow Implementation Guide (Staging)

## Objective

Prepare a safe n8n workflow to consume backend staging for WhatsApp triage and controlled delivery flow, without enabling production providers.

## Scope and Safety

In scope:

- WhatsApp/n8n staging integration
- Triage webhook consumption
- Controlled delivery trigger via backend API

Out of scope in this phase:

- Stripe/payments
- Memed real activation
- WhatsApp provider real activation
- Any production changes

## Base URL

`https://mdoctor-backend-staging-staging.up.railway.app`

## Endpoints

1. `GET /api/whatsapp/status`
2. `POST /api/whatsapp/webhook`
3. `POST /api/atendimentos/:id/deliver`

## Required Headers

For `POST /api/whatsapp/webhook`:

- `X-MDoctor-Webhook-Secret: <N8N_WEBHOOK_SECRET>`
- `X-Correlation-Id: <uuid-v4>`
- `Idempotency-Key: <provider-message-id-or-uuid>`
- `Content-Type: application/json`

For `POST /api/atendimentos/:id/deliver`:

- `Authorization: Bearer <jwt-token>`
- `X-Correlation-Id: <same-event-correlation-id>`
- `Content-Type: application/json`

## WhatsApp Triage Payload Example

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

## Prescription Delivery Payload Example

```json
{
  "channel": "whatsapp"
}
```

## Expected Responses

### 200 Success (`POST /api/whatsapp/webhook`)

```json
{
  "success": true,
  "correlationId": "uuid-or-provided-value",
  "reply": "Recebemos seus dados. Sua solicitação entrou na fila médica para análise.",
  "atendimento": {
    "id": "uuid",
    "status": "waiting"
  }
}
```

### 200 Duplicate (`POST /api/whatsapp/webhook`)

```json
{
  "success": true,
  "duplicate": true,
  "idempotencyKey": "same-key",
  "correlationId": "uuid-or-provided-value",
  "atendimento": {
    "id": "same-uuid-as-first-processing"
  }
}
```

### 401 Unauthorized (`POST /api/whatsapp/webhook`)

```json
{
  "success": false,
  "error": "Webhook não autorizado",
  "correlationId": "uuid-or-provided-value"
}
```

### 429 Rate Limited (`POST /api/whatsapp/webhook`)

```json
{
  "success": false,
  "error": "Webhook temporariamente limitado. Tente novamente em instantes."
}
```

## n8n Flow (Step by Step)

1. Receive inbound WhatsApp message in n8n.
2. Normalize inbound data and build backend triage payload.
3. Generate `correlationId` (UUID v4) for this business event.
4. Generate `idempotencyKey` from provider `messageId` (or deterministic fallback).
5. Call `POST /api/whatsapp/webhook` with required headers.
6. Handle backend response:
   - `200` + `duplicate=true`: stop duplicate processing and reuse known result.
   - `200` success: continue normal flow.
   - `401`: stop and alert (credential/config issue).
   - `429`: delay/retry cautiously with same idempotency key.
7. When applicable and with authenticated backend token, call `POST /api/atendimentos/:id/deliver`.
8. Log outcome in n8n with correlation id, idempotency key, request/response metadata.

## Retry Policy

- Retry only on `5xx` and network timeouts.
- Do not retry on `401`.
- For `429`, use backoff and retry carefully.
- Always reuse the same `Idempotency-Key` for retries of the same event.

## Operational Notes

- Keep `X-Correlation-Id` the same across webhook and any subsequent calls related to the same event.
- Never log or expose real secret values.
- Keep Stripe/payments flow isolated from WhatsApp/n8n staging flow in this phase.
- Keep Memed real isolated from this n8n staging rollout.

## Current Endpoint Validation Snapshot (Staging)

- `GET /api/whatsapp/status`: validated (`200`).
- `POST /api/whatsapp/webhook`: validated (`200` success path).
- `POST /api/atendimentos/:id/deliver`: endpoint validated and protected by auth (`401` without bearer token, as expected).
