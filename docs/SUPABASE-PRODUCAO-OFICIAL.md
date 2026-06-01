# Supabase produção oficial — Doctor Prescreve

Banco definitivo. **Sem fallback in-memory.** Falha de banco → HTTP `503` (`PERSISTENCE_REQUIRED`).

## Checklist de fechamento (itens 1–6)

### 1. Projeto Supabase oficial (manual no dashboard)

| Passo | Ação |
|-------|------|
| Criar projeto | [supabase.com](https://supabase.com) → região `sa-east-1` |
| Copiar keys | Settings → API: `URL`, `anon`, `service_role` |
| Connection string | Settings → Database → URI → `SUPABASE_DB_URL` |
| Pooling | Usar connection pooling (porta 6543) no Railway se disponível |

### 2. Aplicar migrations (ordem obrigatória)

```bash
cd mdoctor-backend
npm install
# Definir SUPABASE_DB_URL no .env ou LOAD_RAILWAY_VARS=1
npm run supabase:migrate
```

Arquivos:

1. `20260527_backend_mvp_storage.sql`
2. `20260528_receitas_anteriores_bucket.sql`
3. `20260529_clinical_receipt_status_flow.sql`
4. `20260530_webhook_events_idempotency.sql`
5. `20260601_doctor_prescreve_production_official.sql`
6. `20260602_fechamento_stripe_payments_idempotency.sql`

### 3. Validar infraestrutura

```bash
# .env com SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run supabase:validate
```

Confirma tabelas: `appointments`, `patients`, `triage_sessions`, `payments`, `payment_events`, `n8n_events`, etc. e buckets oficiais.

### 4. Railway — variáveis definitivas

**Remover** (projeto Supabase antigo):

- `SUPABASE_URL` antiga
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY` antigas
- `SUPABASE_ANON_KEY` antiga (se apontar projeto velho)

**Adicionar / manter:**

| Variável | Valor |
|----------|--------|
| `SUPABASE_URL` | URL do projeto **novo** |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role do projeto **novo** |
| `SUPABASE_REQUIRED` | `true` |
| `DISABLE_LOCAL_DB_FALLBACK` | `true` |
| `ENVIRONMENT_NAME` | `staging` ou `production` |
| `N8N_WEBHOOK_SECRET` | secret ingress (n8n + rotas abertas) |
| `STRIPE_SECRET_KEY` | Stripe live/test conforme ambiente |
| `STRIPE_WEBHOOK_SECRET` | signing secret do endpoint `/api/webhooks/stripe` |

Opcional painel: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (somente se painel chamar Supabase direto).

```bash
# Carregar vars do Railway staging backend e aplicar SQL
LOAD_RAILWAY_VARS=1 npm run supabase:migrate
```

### 5. Testes de fechamento

```bash
npm run supabase:fechamento      # testes 1–7 integrados
npm run supabase:test            # testes persistência 1–10
```

Após deploy Railway: `GET /readyz` deve retornar `storage.mode: "supabase"`.

### 6. Stripe + idempotência

- Endpoint: `POST /api/webhooks/stripe` (body raw, assinatura `stripe-signature`)
- Metadata obrigatória no Checkout: `atendimento_id` (UUID do `appointments`)
- Idempotência: `payment_events.provider_event_id` = Stripe `event.id` (unique index)
- Webhook triagem/WhatsApp: `n8n_events.idempotency_key`

## Arquitetura de persistência

```
Typebot/n8n → /api/webhook/triagem | /api/whatsapp/webhook
       ↓
clinical-persistence.service
  → patients, triage_sessions, medical_eligibility, typebot_sessions, medical_records
  → appointments (fila)
       ↓
Stripe → /api/webhooks/stripe → payments + payment_events → appointments.payment_status
```

Rotas HTTP **inalteradas** (`/api/atendimentos`, etc.). Persistência interna em tabelas oficiais.

## Tabelas críticas validadas

`appointments`, `patients`, `triage_sessions`, `triage_answers`, `medical_records`, `medical_decisions`, `payments`, `payment_events`, `prescriptions`, `prescription_delivery`, `support_tickets`, `whatsapp_messages`, `whatsapp_sessions`, `n8n_events`, `typebot_sessions`, `audit_logs`, `integration_logs`, `error_logs`

## Storage buckets

`receitas`, `uploads`, `prontuarios`, `anexos`, `receitas-antigas`, `documentos-clinicos`

Upload de teste (service role):

```javascript
// via backend /api/upload-receita ou script dedicado
```

## n8n / Typebot

- Webhook backend: `{BACKEND}/api/webhook/triagem` e `{BACKEND}/api/whatsapp/webhook`
- Header: `X-MDoctor-Webhook-Secret: $N8N_WEBHOOK_SECRET`
- Idempotency-Key recomendado em cada POST
- n8n deve usar **nova** `SUPABASE_URL` apenas se nó Supabase direto; fluxo canônico persiste via backend

## Limpeza pós-validação

Descomentar no final de `20260601_doctor_prescreve_production_official.sql`:

```sql
drop table if exists public.atendimentos cascade;
drop table if exists public.webhook_events cascade;
```

## Commits desta fase (sugeridos)

1. `feat: supabase oficial definitivo` — migrations + scripts migrate/validate
2. `feat: persistência clínica definitiva` — clinical-persistence.service
3. `feat: integração n8n typebot supabase` — triagem + suporte
4. `feat: stripe webhook idempotency` — payments.store + migration 20260602
5. `fix: remoção completa fallback memória` — (já aplicado nos stores)
6. `fix: estabilização persistência produção` — fechamento scripts + docs

## Resultado esperado

- Migrations aplicadas no projeto novo
- Railway com envs novas
- `/readyz` OK
- `npm run supabase:fechamento` verde
- Reinício do serviço **não** apaga dados
- Duplicata de webhook Stripe/n8n **não** duplica pagamento/atendimento

---

## Relatório operacional — virada staging (2026-06-01)

### 1. Git

| Item | Status |
|------|--------|
| Branch | `codex/legacy-compat-infra` |
| Commits exigidos | `a28386a`, `1f73303`, `ba2fb66` presentes no histórico |

### 2. Projeto Supabase oficial novo

| Credencial | Status |
|------------|--------|
| Projeto | `Plataforma-Medica-Mdoctor` — ref `usihurogvphtjedyhyfl` (região **us-west-2**) |
| `SUPABASE_URL` / keys | Configurados em `.env` e Railway staging |
| `SUPABASE_DB_URL` | Pooler: usar host **`aws-1-us-west-2.pooler.supabase.com:5432`** (não `sa-east-1`) |

**Ação manual:** criar projeto em `sa-east-1`, copiar URL + service_role + connection string (pooler 6543) e colar em `mdoctor-backend/.env` + Railway serviço `mdoctor-backend-staging` (`53960eb4-a1be-4d7c-b665-462049e52085`).

### 3. `.env` local

| Variável | Status |
|----------|--------|
| `SUPABASE_REQUIRED=true` | Configurado |
| `DISABLE_LOCAL_DB_FALLBACK=true` | Configurado |
| `ENVIRONMENT_NAME=staging` | Configurado |
| `SUPABASE_SERVICE_ROLE_KEY` | Alias do service key (até troca do projeto) |
| `SUPABASE_DB_URL` | Comentado — preencher com projeto **novo** |

### 4–6. Migrations / validate / fechamento (2026-06-01 — concluído)

| Comando | Resultado |
|---------|-----------|
| `npm run supabase:migrate` | **ok** — 6 arquivos via `aws-1-us-west-2.pooler.supabase.com:5432` |
| `npm run supabase:validate` | **ok: true** — tabelas + buckets + ping |
| `npm run supabase:fechamento` | **success: true**, **migration_pending: false** |

Migrations no repositório (ordem): `20260527` → `20260528` → `20260529` → `20260530` → `20260601` → `20260602`.

**Após credenciais novas:**

```bash
cd mdoctor-backend
npm run supabase:migrate
npm run supabase:validate    # esperado: ok: true
npm run supabase:fechamento  # esperado: success: true, migration_pending: false
```

### 7. Persistência obrigatória (testes 1–10)

**Pendente** até projeto novo + migrations.

### 8–9. Railway staging

| Variável | Status (2026-06-01) |
|----------|---------------------|
| `SUPABASE_URL` | `usihurogvphtjedyhyfl` |
| `SUPABASE_SERVICE_ROLE_KEY` | Sincronizado (`node scripts/railway-sync-supabase-staging-env.js`) |
| `SUPABASE_REQUIRED` | `true` |
| `DISABLE_LOCAL_DB_FALLBACK` | `true` |
| `ENVIRONMENT_NAME` | `staging` |
| Redeploy | Executado |

**Backend staging:** `https://mdoctor-backend-staging-staging.up.railway.app`

### 10. `/readyz` (staging)

- `storage.mode`: **supabase**
- `fallback_local`: **false**
- `supabase.connected`: **true**
- `status`: `warning` (ex.: `NODE_ENV` ≠ production — esperado em staging)

### 11. Rotas staging

**Pendente** smoke completo após migrations no banco novo:

- `POST /api/webhook/triagem` (header `X-MDoctor-Webhook-Secret`)
- `GET /api/atendimentos`, `GET /api/fila`
- `POST /api/suporte`, `GET /api/suporte/pendentes`
- `POST /api/webhooks/stripe`
- `POST /api/whatsapp/webhook`

Script existente: `node scripts/staging-e2e-operacional.js` (com `N8N_WEBHOOK_SECRET`).

### 12. n8n / Typebot

Fluxo canônico: **backend** (`/api/webhook/triagem`, `/api/whatsapp/webhook`), header `X-MDoctor-Webhook-Secret`.

Alguns exports Typebot/n8n ainda referenciam storage público do projeto legado (`thbwoogytwcidxrrboym`) para PDFs LGPD — não é persistência clínica; revisar após cutover se URLs públicas mudarem.

### 13. Pendências restantes

1. Ajustar `SUPABASE_DB_URL` no `.env` para pooler **us-west-2** (`aws-1-us-west-2.pooler.supabase.com:5432`, user `postgres.usihurogvphtjedyhyfl`).
2. Smoke HTTP staging: `node scripts/staging-e2e-operacional.js` (triagem, fila, suporte).
3. Produção Railway (`web`): cutover separado quando autorizado.
4. Remover tabelas legadas (`atendimentos`, `webhook_events`) após validação clínica — SQL comentado em `20260601`.
