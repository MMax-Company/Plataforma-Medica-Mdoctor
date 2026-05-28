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
- Public URL check currently returns `502`.

Observed runtime logs indicate n8n booting and migrations finishing, then editor bound locally (`http://localhost:5678`), suggesting network binding/config still needs final tuning for Railway ingress.

## Admin/Env Notes

Current env snapshot for `n8n-staging` includes Railway defaults only.

Recommended minimal runtime vars for ingress stabilization (staging only):

- `N8N_HOST=0.0.0.0`
- `N8N_PORT=5678`
- `N8N_PROTOCOL=https`

Recommended security vars before use:

- `N8N_BASIC_AUTH_ACTIVE=true`
- `N8N_BASIC_AUTH_USER=<staging-admin>`
- `N8N_BASIC_AUTH_PASSWORD=<strong-secret>`
- `N8N_ENCRYPTION_KEY=<strong-secret>`

## Current Blocker

- Applying additional env vars failed due Railway API timeout during this session (`backboard.railway.com/graphql/v2` timeout).
- As a result, runtime exists and is isolated, but external access remains blocked (`502`) pending env tuning/redeploy.

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
- Runtime externally usable right now: **not yet** (`502` until env tuning is applied).
