# Validação E2E staging — Doctor Prescreve

**Data:** 2026-06-01  
**Ambiente:** staging (não é produção pública)  
**Backend:** https://mdoctor-backend-staging-staging.up.railway.app  
**Painel:** https://painel-medico-staging-staging.up.railway.app  
**Supabase oficial:** `usihurogvphtjedyhyfl` (us-west-2)

## Resultado geral

| Item | Status |
|------|--------|
| `npm run staging:e2e` (`staging-e2e-operacional.js`) | **OK** |
| `npm run staging:e2e:validacao` (`staging-e2e-validacao-completa.js`) | **OK** (com avisos) |
| `/readyz` → `storage.mode=supabase`, `fallback_local=false` | **OK** |
| Persistência obrigatória (sem memória) | **OK** |
| Stripe HTTP staging | **Pendente** (404 — keys não sincronizadas no Railway) |

Relatório JSON: [STAGING-E2E-VALIDACAO.json](./STAGING-E2E-VALIDACAO.json)

## Como executar

```powershell
cd mdoctor-backend
$env:LOAD_RAILWAY_VARS = '0'
$env:N8N_WEBHOOK_SECRET = 'staging-n8n-webhook-20260528'
$env:MEDICO_USER = 'drmax.matos'
$env:MEDICO_PASS = 'Gr@tid@0'
$env:PANEL_URL_STAGING = 'https://painel-medico-staging-staging.up.railway.app'

npm run staging:e2e
npm run staging:e2e:validacao
```

**Nota:** não use `LOAD_RAILWAY_VARS=1` no shell ao rodar localmente — isso pode sobrescrever o Supabase novo com credenciais antigas.

## Testes executados

### 1. Triagem

| Endpoint | Resultado |
|----------|-----------|
| `POST /api/webhook/triagem` | 200, `success: true`, `atendimentoId` retornado |
| Persistência | Linha em `atendimentos` (deploy atual); `appointments` após redeploy do código mais recente |
| `triage_sessions` | Aviso — não encontrada neste deploy (verificar `clinical-persistence` no Railway) |
| `audit_logs` | Criados |

### 2. Fila

| Endpoint | Resultado |
|----------|-----------|
| `POST /api/auth/login` | OK (`drmax.matos`) |
| `GET /api/atendimentos/queue` | OK |
| `GET /api/fila` | OK (legacy `LEGACY_COMPAT_PANEL`) |

### 3. Suporte

Rotas canônicas (não existem `/api/suporte` nem `/api/suporte/pendentes`):

| Endpoint | Resultado |
|----------|-----------|
| `POST /api/whatsapp/support` | OK |
| `GET /api/atendimentos/support-queue` | OK (autenticado) |
| Tabela `support_tickets` | Acessível |

### 4. WhatsApp

| Endpoint | Resultado |
|----------|-----------|
| `POST /api/whatsapp/webhook` | OK |
| Idempotência (`Idempotency-Key`) | OK (duplicate/409) |
| `whatsapp_messages` | Aviso — depende do deploy persistir mensagens |

### 5. Stripe

| Endpoint | Resultado |
|----------|-----------|
| `POST /api/webhooks/stripe` | **404** no staging (variáveis Stripe não aplicadas no Railway — timeout ao sincronizar) |
| Idempotência local | Validada em `npm run supabase:fechamento` |

**Ação:** `node scripts/railway-sync-stripe-staging-env.js` + redeploy quando Railway estiver estável.

### 6. Prontuário

| Teste | Resultado |
|-------|-----------|
| `medical_records` insert/read via service role | OK |
| Relação `appointment_id` | OK |

### 7. Dashboard / painel

| Teste | Resultado |
|-------|-----------|
| `GET /api/atendimentos?scope=medical` | OK |
| Painel `GET /dashboard` | HTTP 200 |

### 8. `/readyz`

```json
{
  "storage": { "mode": "supabase" },
  "fallback_local": false,
  "supabase": { "connected": true, "mode": "supabase" }
}
```

### 9. Restart / persistência

Leitura Supabase após fluxo HTTP confirma que dados do atendimento de teste permanecem (não dependem de memória do processo).

### 10. Logs

| Tabela | Acessível |
|--------|-----------|
| `audit_logs` | Sim |
| `integration_logs` | Sim |
| `error_logs` | Sim |
| `n8n_events` | Sim |

### 11. Relacionamentos

Validados quando `patient_id` presente: `appointments/atendimentos` ↔ `patients`, `triage_sessions` ↔ appointment.

### 12. Performance básica

3× `POST /api/webhook/triagem` sequenciais com `Idempotency-Key` distintos → todos 200, sem erro de persistência.

## Correções aplicadas nesta etapa

1. **`load-dotenv.js`** — não sobrescreve variáveis já definidas no shell; ignora valores vazios em `.env.local`.
2. **`staging-e2e-validacao-completa.js`** — validação HTTP + Supabase; detecta `atendimentos` vs `appointments`.
3. **`staging-e2e-operacional.js`** — credenciais `MEDICO_OFFICIAL_*`.
4. Scripts Railway: `railway-sync-supabase-staging-env.js`, `railway-sync-stripe-staging-env.js`.

## Pendências staging

1. **Redeploy backend** com branch `codex/legacy-compat-infra` para gravar em `appointments` + `persistTriagemFlow` completo.
2. **Stripe no Railway** — sincronizar `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ENABLED=true`.
3. **Smoke Stripe** — repetir após item 2.
4. **Produção** — cutover separado; não misturar com este checklist.

## Status final

**Staging operacional para E2E assistido:** triagem, fila autenticada, suporte, WhatsApp webhook, painel, Supabase oficial, sem fallback memória.

**Próximo passo recomendado:** fechar painel/Memed/E2E clínico após redeploy do backend com persistência completa em `appointments` + Stripe staging.
