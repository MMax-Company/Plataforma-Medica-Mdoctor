# Supabase produção oficial — Doctor Prescreve

Banco definitivo do sistema. **Sem fallback in-memory.** Se o Supabase falhar, a API retorna erro `503` (`PERSISTENCE_REQUIRED`).

## 1. Novo projeto Supabase

1. Criar projeto em [supabase.com](https://supabase.com) (região `sa-east-1` recomendada para BR).
2. Anotar:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` (secret) → `SUPABASE_SERVICE_ROLE_KEY`
   - `anon` → apenas no frontend, se necessário
3. Aplicar migrations em ordem:

```bash
# Via SQL Editor ou CLI
mdoctor-backend/supabase/migrations/20260527_backend_mvp_storage.sql
mdoctor-backend/supabase/migrations/20260528_receitas_anteriores_bucket.sql
mdoctor-backend/supabase/migrations/20260529_clinical_receipt_status_flow.sql
mdoctor-backend/supabase/migrations/20260530_webhook_events_idempotency.sql
mdoctor-backend/supabase/migrations/20260601_doctor_prescreve_production_official.sql
```

4. Validar com:

```bash
node mdoctor-backend/scripts/supabase-production-persistence-test.js
```

## 2. Variáveis de ambiente (Railway / produção)

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `SUPABASE_URL` | Sim | URL do projeto **novo** |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim | Chave service role (backend only) |
| `SUPABASE_REQUIRED` | Sim (`true`) | Bloqueia boot sem banco |
| `DISABLE_LOCAL_DB_FALLBACK` | Sim (`true`) | Legado; mantido para readiness |
| `ENVIRONMENT_NAME` | `staging` / `production` | Runtime estrito |

**Remover** URLs e keys de projetos Supabase antigos em Railway, n8n e `.env` locais.

Modo local **somente** para smoke sem banco: `SUPABASE_PERSISTENCE_OPTIONAL=true` (não usar em staging/prod).

## 3. Arquitetura de persistência

```
API Express → stores → Supabase (service_role)
                ↓
         appointments (fila/prontuário/receita)
         patients, triage_sessions, medical_eligibility
         prescriptions, prescription_delivery
         support_tickets, audit_logs, n8n_events
         whatsapp_messages, payments, ...
```

Rotas HTTP mantêm paths atuais (`/api/atendimentos`, etc.). Internamente, `atendimentos.store` persiste em **`appointments`**.

## 4. Tabelas oficiais (35+)

| Domínio | Tabelas |
|---------|---------|
| Paciente | `patients`, `patient_addresses`, `patient_documents` |
| Triagem | `triage_sessions`, `triage_answers`, `medical_protocols`, `medical_eligibility` |
| Atendimento | `appointments`, `appointment_status_history` |
| Suporte | `support_tickets`, `support_messages` |
| Pagamento | `payments`, `payment_events` |
| Receita | `prescriptions`, `prescription_items`, `prescription_delivery` |
| Prontuário | `medical_records`, `medical_record_versions`, `medical_decisions`, `medical_logs` |
| Auditoria | `audit_logs`, `integration_logs`, `error_logs`, `system_events` |
| Integrações | `whatsapp_sessions`, `whatsapp_messages`, `n8n_events`, `typebot_sessions` |
| Upload | `uploaded_files`, `uploaded_prescriptions` |
| Médicos | `doctor_profiles`, `doctor_sessions`, `doctor_permissions` |
| Sistema | `system_settings` |

Migração copia dados de `atendimentos` → `appointments` quando a tabela legada existir.

## 5. Storage buckets

| Bucket | Uso |
|--------|-----|
| `receitas` | PDFs emitidos (Memed) |
| `uploads` | Upload externo Typebot |
| `prontuarios` | Documentos de prontuário |
| `anexos` | Anexos gerais |
| `receitas-antigas` | Foto receita anterior |
| `documentos-clinicos` | Consentimentos / documentos |

## 6. RLS

Todas as tabelas com RLS habilitado. Política padrão: **`service_role` full access** (backend). Acesso `anon`/`authenticated` bloqueado até políticas por perfil médico (fase Auth Supabase).

## 7. Fluxos persistidos

| Fluxo | Tabela principal |
|-------|------------------|
| Paciente Typebot | `patients` + `triage_sessions` |
| Elegibilidade | `medical_eligibility` + `appointments.eligibility` |
| Fila médica | `appointments` |
| Prontuário | `medical_records` |
| Decisão médica | `medical_decisions` + `audit_logs` |
| Memed | `prescriptions` |
| Entrega WhatsApp | `prescription_delivery` + `whatsapp_messages` |
| Suporte | `support_tickets` |
| Webhook n8n | `n8n_events` (idempotência) |
| Stripe | `payments` + `payment_events` |

## 8. Testes obrigatórios

Script único: `scripts/supabase-production-persistence-test.js` (testes 1–10).

Teste de carga: executar múltiplas vezes com `ts` diferente; confirmar ausência de duplicidade via `n8n_events.idempotency_key` nos webhooks.

## 9. Limpeza pós-validação

Após validar dados migrados, descomentar no final da migration `20260601`:

```sql
drop table if exists public.atendimentos cascade;
drop table if exists public.decisoes_log cascade;
drop table if exists public.entregas_receita cascade;
drop table if exists public.webhook_events cascade;
```

## 10. Commits sugeridos

1. `feat: estrutura oficial supabase produção`
2. `feat: persistência clínica definitiva`
3. `feat: integração backend supabase oficial`
4. `feat: storage e auditoria clínica`
5. `fix: remoção fallback in-memory`
6. `fix: estabilização persistência produção`
