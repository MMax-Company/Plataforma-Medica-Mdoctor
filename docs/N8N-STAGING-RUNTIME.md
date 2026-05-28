# n8n Staging Runtime - Preparation Log

Data/hora: 2026-05-28 07:44 -03:00

## Objective

Create a dedicated n8n staging runtime isolated from production in Railway.

## Scope and Safety Guardrails

- No production mutation allowed.
- No backend/panel code changes.
- No WhatsApp real activation.
- No Stripe activation.
- No secret values committed to git.

## Railway Identification

- Project: `Automation-MDoctor`
- Project ID: `fe962e4e-4c41-4c94-9d2d-dbdfe37d0ed4`

Initial state confirmed:

- Existing n8n runtime in production only:
  - Service: `n8n Node`
  - Service ID: `07ab35a6-b8d5-4cdc-85ea-2579468ca355`
  - Environment: `production`
  - Environment ID: `3e722637-48e4-4fd8-b3f8-efdd753ee874`

## Dedicated Staging Runtime Creation

Created safely in `Automation-MDoctor`:

- New environment:
  - Name: `staging`
  - Environment ID: `6c77be19-3b24-46a2-9fc2-4511b920f5aa`
- New service:
  - Name: `n8n-staging`
  - Service ID: `87ba8406-d695-4f2b-b156-9a14fdebc537`
  - Image: `n8nio/n8n:latest`

Generated Railway public domain:

- `https://n8n-staging-staging-2dfe.up.railway.app`

## Runtime Health Check

- Service deployment status in staging: `SUCCESS` (instance running).
- Public URL check: resolved (`200`).
- Endpoints validated:
  - `GET /` -> `200`
  - `GET /healthz` -> `200`
  - `GET /rest/settings` -> `200`
  - `POST /webhook-test/ping` -> `404` (expected when workflow/webhook is not yet created, confirms route reachability)

## Admin/Env Notes

Ingress stabilized in staging with these vars:

- `N8N_HOST=0.0.0.0`
- `N8N_PORT=5678`
- `PORT=5678`
- `N8N_PROTOCOL=http`
- `N8N_PROXY_HOPS=1`
- `WEBHOOK_URL=https://n8n-staging-staging-2dfe.up.railway.app`
- `N8N_EDITOR_BASE_URL=https://n8n-staging-staging-2dfe.up.railway.app`

Recommended security vars before use:

- `N8N_BASIC_AUTH_ACTIVE=true`
- `N8N_BASIC_AUTH_USER=<staging-admin>`
- `N8N_BASIC_AUTH_PASSWORD=<strong-secret>`
- `N8N_ENCRYPTION_KEY=<strong-secret>`

## Current Blocker

- No blocking issue for ingress at this moment.
- Remaining setup before real usage is operational hardening (basic auth, encryption key, workflow credentials), all in staging only.

## Risk Assessment

- Production risk: low (new env + new service only; production service untouched).
- Operational risk: medium until staging runtime passes public health check.
- Secret leakage risk: controlled (no secrets committed in repository/docs).

## Next Safe Steps

1. Retry setting runtime vars on `n8n-staging` in `staging` env only.
2. Redeploy/restart only `n8n-staging`.
3. Validate URL returns n8n login/setup page (not `502`).
4. Configure n8n staging workflow secrets in Railway only.
5. Keep production `n8n Node` untouched.

## Conclusion

- n8n staging runtime created: **yes** (dedicated env/service).
- Public URL available: **yes**.
- Runtime externally usable right now: **yes** (`502` resolved).

## Typebot Webhook Activation (staging)

Data/hora: 2026-05-28 09:35 -03:00

Status:

- Workflow ativo no n8n staging: **sim**
- Webhook path publicado: `POST /webhook/typebot-webhook`
- URL final:
  - `https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook`

Fluxo implementado no workflow ativo:

- Recebe payload do Typebot staging-safe.
- Propaga `X-Correlation-Id` (header recebido ou gerado).
- Propaga `Idempotency-Key` (header recebido ou `messageId` payload).
- Encaminha para backend staging:
  - `POST https://mdoctor-backend-staging-staging.up.railway.app/api/whatsapp/webhook`
- Inclui header:
  - `X-MDoctor-Webhook-Secret`
- Retorna JSON ao caller (Typebot/n8n client) com resultado do backend.

Validacao operacional:

- `POST /webhook/typebot-webhook` passou de `404` para `200`.
- Repeticao com mesma key retornou `duplicate=true`.
- `audit_logs` no Supabase confirmados (`webhook_processed` e `webhook_duplicate_ignored`).
- Painel staging manteve `/dashboard` com `200`.

Observacoes de seguranca:

- Alteracoes realizadas somente no runtime `n8n-staging`.
- Nao houve alteracao em `n8n Node` de producao.
- Nenhum segredo foi commitado no repositorio.

## Integracao Typebot + Evolution dry-run (2026-05-28)

Validacao E2E:

- `POST /webhook/typebot-webhook` -> `200`
- encaminhamento para backend staging com secret/correlation/idempotency OK
- atendimento criado e visivel no painel
- delivery via backend retorna `provider=dry-run` com `WHATSAPP_DRY_RUN=true`

Detalhes: `docs/E2E-TYPEBOT-N8N-EVOLUTION-STAGING.md`
