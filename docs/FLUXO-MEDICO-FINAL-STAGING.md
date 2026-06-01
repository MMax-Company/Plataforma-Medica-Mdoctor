# Fluxo médico final — staging

Documento de fechamento do ciclo clínico **Doctor Prescreve** em staging (Supabase oficial `usihurogvphtjedyhyfl`).

## Ambiente

| Item | Valor |
|------|--------|
| Backend | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel | `https://painel-medico-staging-staging.up.railway.app` |
| Supabase | `usihurogvphtjedyhyfl` (us-west-2) |
| Tabela operacional | `appointments` (`SUPABASE_APPOINTMENTS_TABLE=appointments`) |
| Login médico staging | `drmax.matos` (senha em Railway) |

## Rotas canônicas (API)

| Etapa | Método | Rota |
|-------|--------|------|
| Triagem Typebot/n8n | `POST` | `/api/webhook/triagem` |
| Fila médica | `GET` | `/api/atendimentos/queue` |
| Detalhe atendimento | `GET` | `/api/atendimentos/:id` |
| Aprovação clínica | `POST` | `/api/atendimentos/:id/clinical/approve` |
| Memed — persistir receita | `POST` | `/api/memed/receita` |
| Validar receita | `POST` | `/api/atendimentos/:id/clinical/validate` |
| Entregar (WhatsApp) | `POST` | `/api/atendimentos/:id/deliver` |
| Stripe webhook | `POST` | `/api/webhooks/stripe` |
| Health | `GET` | `/readyz` |

## O que foi implementado

### 1. Appointments definitivo

- `getAppointmentTable()` força `appointments` quando `SUPABASE_APPOINTMENTS_TABLE=appointments`.
- `normalizeAtendimento()` persiste `patient_id`.
- `linkPatientToAppointment()` após triagem.
- Espelhamento `atendimentos` → `appointments` em create/update/read (ponte até deploy 100% no Railway).
- Script `npm run migrate:atendimentos-appointments` — backfill + vínculo `patient_id` por telefone.
- Railway: variável `SUPABASE_APPOINTMENTS_TABLE=appointments` sincronizada.

### 2. Triagem e elegibilidade

- `persistTriagemFlow()` grava `triage_sessions`, `triage_answers`, `medical_eligibility`, `medical_records`, `typebot_sessions`.
- `findOrCreatePatient()` evita duplicidade e garante FK.
- Deploy `mdoctor-backend-staging` (`52ff0649`+) com `clinical-persistence` ativo; triagem popula `triage_sessions`, `medical_eligibility`, `medical_records` no Supabase oficial.

### 2.1 Audit logs (schema)

- Migration `20260603_audit_logs_staging_align.sql`: colunas `origin`, `ip_address` (text), `updated_at` em `public.audit_logs` (MVP legado não tinha `origin`/`ip_address` — triagem falhava com erro de schema cache).
- Aplicar: `LOAD_RAILWAY_VARS=0 node mdoctor-backend/scripts/apply-audit-logs-migration.js` (pooler `us-west-2`).
- `correlation_id`, `request_id`, `user_agent`, etc. permanecem apenas em `payload` jsonb (`audit.store.js`).

### 3. Memed e receita

- Persistência oficial em `prescriptions` (+ compat `receitas_memed` para build legado em staging).
- Migration `20260601_receitas_memed_compat.sql` aplicada no Supabase oficial.
- Fluxo HTTP: approve → `/api/memed/receita` → validate → deliver validado em E2E.

### 4. Prontuário

- `recordMedicalRecord()` com bloco estruturado `prontuario` (identificação, HDA, medicações, alergias, elegibilidade, conduta, orientações).

## E2E automatizado

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=0 npm run staging:e2e:fluxo-medico
```

Relatório JSON: [FLUXO-MEDICO-FINAL-STAGING.json](./FLUXO-MEDICO-FINAL-STAGING.json)

Última execução (resumo) — revalidado `2026-06-01`:

- **success:** `true` (19 passos, 0 erros)
- **Service:** `mdoctor-backend-staging` — ver [STAGING-FECHAMENTO-POS-E2E.md](./STAGING-FECHAMENTO-POS-E2E.md)
- **HTTP:** triagem, login, fila, approve, Memed mock, validate, deliver, status `delivered`
- **Supabase:** `appointments`, `triage_sessions`, `medical_eligibility`, `medical_records`, `prescriptions`, `prescription_delivery`; ref `usihurogvphtjedyhyfl`

## Stripe staging

- Rota: `POST /api/webhooks/stripe` (raw body + assinatura).
- Railway staging: `STRIPE_ENABLED=true`, `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` sincronizados via `npm run railway:sync-stripe-staging` (chaves em `mdoctor-backend/.env`, não commitar).
- `/readyz`: check `stripe_webhook_secret` **ok** após redeploy.
- **Pendente:** cadastrar endpoint no Stripe Dashboard (URL staging) + evento de teste.
- Tabelas: `payments`, `payment_events`, `webhook_events` (migration `20260602_fechamento_stripe_payments_idempotency.sql`).

## Deploy / CI

- **Staging:** deploy manual (`railway up`); GitHub **não** conectado ao service `mdoctor-backend-staging` (`source.repo: null`).
- **Production `web`:** Git deploy ativo — **não** usar para homologação clínica staging.
- Conectar repo ao service staging: passo manual documentado em [STAGING-FECHAMENTO-POS-E2E.md](./STAGING-FECHAMENTO-POS-E2E.md).

## Supabase local (migrations)

- `SUPABASE_DB_URL` no `.env` local: pooler **`aws-1-us-west-2`**, usuário `postgres.usihurogvphtjedyhyfl` (ver `.env.example`).

## Operação assistida

1. `LOAD_RAILWAY_VARS=0 npm run railway:sync-supabase-staging`
2. `railway up` na service backend staging (`53960eb4-a1be-4d7c-b665-462049e52085`)
3. `LOAD_RAILWAY_VARS=0 npm run migrate:atendimentos-appointments`
4. `LOAD_RAILWAY_VARS=0 npm run staging:e2e:fluxo-medico`
5. Painel: fila → prontuário → Memed widget → confirmar receita → entregar

## Checklist de aceite

| Critério | Status |
|----------|--------|
| Triagem HTTP 200 + `atendimentoId` | OK |
| Fila / painel (API) | OK |
| Decisão médica (approve) | OK |
| Memed mock persist | OK |
| Validação + entrega HTTP | OK |
| `appointments` com registro | OK (espelho + migrate) |
| `triage_sessions` no Supabase | OK |
| `audit_logs` (`origin`, `ip_address`) | OK (migration `20260603`) |
| `prescriptions` / `prescription_delivery` | OK (tabelas oficiais) |
| Stripe vars Railway staging | OK (`STRIPE_ENABLED=true`) |
| Stripe Dashboard webhook URL | Pendente cadastro manual |
| Deploy auto staging (GitHub) | Pendente conectar repo ao service |
| Boot strict delivery mock | OK (`ALLOW_PRODUCTION_DELIVERY_MOCK=true`) |

## Commits sugeridos (ordem)

1. `feat: appointments definitivo staging`
2. `feat: triage sessions persistência clínica`
3. `feat: integração memed staging`
4. `feat: emissão e entrega receita`
5. `fix: integridade clínica e relacionamentos`
6. `test: e2e médico completo staging`
