# N8N Secrets Hardening - Doctor Prescreve

Data/hora: 2026-05-28 08:23 -03:00

## Scope

Hardening of n8n workflow configuration to remove hardcoded secrets and enforce staging/production separation.

## Source Files Reviewed

- `mdoctor-automation/flows/whatsapp-flow.json`
- `mdoctor-automation/flows/whatsapp-router.json`

Note:

- The file named `Automação MDoctor Prescreve.json` was not found in the workspace.
- Hardening was applied to the available Doctor Prescreve n8n workflow files and exported as a secure staging-safe workflow.

## Secrets Audit Result

Hardcoded secrets found in reviewed workflow files:

- Z-API tokens: `0`
- Supabase keys/URLs hardcoded as secrets: `0`
- Memed secrets: `0`
- Bearer tokens: `0`
- API keys/tokens embedded in node headers/body: `0`

Hardcoded values still normalized for safety:

- Local fallback URL strings replaced by explicit env-driven routing in safe export.

## Required n8n Environment Variables

Core routing:

- `FLOW_ENV` (`staging` or `production`)
- `BACKEND_URL_STAGING` (for staging runtime only)
- `BACKEND_URL_PRODUCTION` (for production runtime only)

Webhook security and tracing:

- `N8N_WEBHOOK_SECRET`
- `N8N_WORKFLOW_NAME` (optional label)

Optional provider/service vars (for future real integrations):

- `ZAPI_INSTANCE`
- `ZAPI_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `MEMED_API_KEY`

## Staging vs Production Separation

Separation strategy in safe workflow export:

- Runtime decides backend target by `FLOW_ENV`.
- Staging points to `BACKEND_URL_STAGING`.
- Production points to `BACKEND_URL_PRODUCTION`.
- No literal secret/token is stored in workflow JSON.

## Safe Export

Exported secure workflow:

- `docs/n8n-workflows/doctor-prescreve-staging-safe.json`

Includes:

- `X-MDoctor-Webhook-Secret` from env
- `X-Correlation-Id` generated per event
- `Idempotency-Key` generated from incoming message id or fallback
- handling for:
  - `200` success
  - `200` with `duplicate=true`
  - `401` unauthorized
  - `429` rate limited

## Validation Performed

- JSON parse check: valid
- No hardcoded secrets in exported workflow
- Nodes and connections structure preserved for import
- URLs resolved by environment variables (staging-safe)

## Security Outcome

- Secrets hardcoded removed/externalized: `0` found in source; safe export enforces env-only secret usage.
- Workflow hardened for secure staging rollout without impacting production runtime.
