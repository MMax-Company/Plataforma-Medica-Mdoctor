# Fechamento pós-E2E — staging clínico

Data de referência: **2026-06-01**

## Serviço canônico (não usar `web` / production)

| Item | Valor |
|------|--------|
| Railway service | **`mdoctor-backend-staging`** |
| Service ID | `53960eb4-a1be-4d7c-b665-462049e52085` |
| Environment | `staging` (`d297af6e-c5e2-406a-9798-69a02f0e7394`) |
| URL | https://mdoctor-backend-staging-staging.up.railway.app |
| Supabase | **`usihurogvphtjedyhyfl`** (us-west-2) |
| **Não usar** | `web` → https://web-production-5f178.up.railway.app (legado / outro Supabase) |

## E2E médico

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=0 npm run staging:e2e:fluxo-medico
```

Relatório: [FLUXO-MEDICO-FINAL-STAGING.json](./FLUXO-MEDICO-FINAL-STAGING.json)

Última execução confirmada: **success true**, 19 passos, 0 erros (triagem → fila → approve → Memed → validate → deliver → `delivered`).

## Stripe staging

| Item | Status |
|------|--------|
| `STRIPE_SECRET_KEY` (Railway staging) | Configurado (test mode `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` (Railway staging) | Configurado (`whsec_…`) |
| `STRIPE_ENABLED` | **`true`** (após `npm run railway:sync-stripe-staging`) |
| `/readyz` → `stripe_webhook_secret` | **ok** (warning only se ausente; presente após sync + redeploy) |
| Endpoint | `POST https://mdoctor-backend-staging-staging.up.railway.app/api/webhooks/stripe` |

Sincronizar do `.env` local (não commitar chaves):

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=0 npm run railway:sync-stripe-staging
railway redeploy --yes   # com service linkada em mdoctor-backend-staging
```

**Pendência operacional:** registrar no Stripe Dashboard o endpoint de webhook apontando para a URL acima (eventos `checkout.session.completed`, etc.) e validar um pagamento de teste.

`.env.local` permanece sem Stripe (dev local) — correto.

## CI / deploy automático

| Serviço | GitHub repo no Railway | Deploy |
|---------|------------------------|--------|
| **`mdoctor-backend-staging`** | **`repo: null`** (sem Git conectado) | Manual: `railway up` / redeploy na UI |
| **`web` (production)** | `Plataforma-Medica-Mdoctor` + `mdoctor-backend` | Auto via push na branch |

Não há `.github/workflows` neste repositório. Push no GitHub **não** atualiza staging automaticamente hoje.

**Ação recomendada (manual, Railway UI):** em `Backend-Mdoctor` → service `mdoctor-backend-staging` → Settings → Connect Repo → `MMax-Company/Plataforma-Medica-Mdoctor`, root `mdoctor-backend`, branch `codex/legacy-compat-infra` (ou branch de staging), environment **staging** apenas. **Não** alterar o service `web` nesta tarefa.

## `.env` local — `SUPABASE_DB_URL`

Corrigido para pooler **us-west-2** (região do projeto oficial):

```text
postgresql://postgres.usihurogvphtjedyhyfl:<senha-url-encoded>@aws-1-us-west-2.pooler.supabase.com:5432/postgres
```

- Antes: `aws-0-sa-east-1` + usuário `postgres` (falha intermitente / tenant not found).
- Senhas com `@` na URI: usar `%40`.
- Template: `mdoctor-backend/.env.example`

Migrations: `LOAD_RAILWAY_VARS=0 node scripts/apply-audit-logs-migration.js` ou `npm run supabase:migrate` (lista em `apply-supabase-migrations-all.js`).

## Histórico de correções deste ciclo

1. Boot strict: `ALLOW_PRODUCTION_DELIVERY_MOCK=true` + redeploy (`52ff0649+`).
2. Schema: `20260603_audit_logs_staging_align.sql` (`origin`, `ip_address`, `updated_at`).
3. E2E fluxo médico completo OK no Supabase oficial.
4. Stripe vars sincronizadas no Railway staging.

## Pendências restantes

1. Conectar **GitHub → `mdoctor-backend-staging`** (deploy automático de staging).
2. Webhook Stripe no Dashboard apontando para URL staging + smoke de pagamento.
3. Painel staging E2E visual (Playwright tour) — opcional.
4. Cutover production (`web`) só após homologação explícita — **fora do escopo staging**.
