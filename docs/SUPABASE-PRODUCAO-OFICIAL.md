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
