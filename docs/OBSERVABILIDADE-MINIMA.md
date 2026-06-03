# Observabilidade Mínima — Go Live Assistido

Evitar operação cega: o que já existe, o que monitorar e como reagir.

---

## 1. Logs e auditoria (implementado)

### 1.1 Audit store (`audit_logs`)

Persistência: Supabase (fallback local em dev).

**Ações clínicas e operacionais já registradas:**

| `action` | Quando |
|----------|--------|
| `clinical_approved` | Approve clínico |
| `clinical_rejected` | Reject com `reason_code` no payload |
| `memed_prescription_validated` | Validate → ready |
| `delivery_completed` | Entrega receita |
| `clinical_record_updated` | Edição prontuário |
| `triagem_webhook` / `webhook_processed` | Entrada triagem/WhatsApp |
| `webhook_duplicate_ignored` | Idempotência |

**Campos úteis no payload:** `correlationId`, `reason_code`, `memedSource`, `whatsappSent`, `protocolVersion`.

### 1.2 Decisão log (`decisoes`)

Transições de status por atendimento (`status_anterior` → `status_novo`, `motivo`, `medico_id`).

API: `GET /api/atendimentos/:id/decisoes`

### 1.3 Logger HTTP

`request-logger` middleware — paths `/health`, `/healthz`, `/readyz` excluídos do rate limit.

Nível: `LOG_LEVEL` (env).

### 1.4 Consulta rápida (Supabase SQL)

```sql
-- Últimos eventos de um atendimento
SELECT action, actor, payload, created_at
FROM audit_logs
WHERE entity_id = '<atendimento-uuid>'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 2. Healthchecks

### 2.1 Backend

| Endpoint | Uso |
|----------|-----|
| `GET /health` | Liveness simples |
| `GET /healthz` | Alias |
| `GET /readyz` | Readiness: JWT, Supabase, Memed, delivery, checks produção |

Exemplo readiness (campos principais):

```json
{
  "status": "ok|warning|fail",
  "storage": { "mode": "supabase", "responding": true },
  "memed": { "configured": false, "source": "mock", "env": "development" },
  "checks": [ ... ]
}
```

### 2.2 Painel

| Endpoint | Uso |
|----------|-----|
| `GET /login` | Página carrega (Railway healthcheck) |

### 2.3 n8n

| Endpoint | Uso |
|----------|-----|
| `GET /healthz` ou `/` | Instância responde |

### 2.4 Typebot

| Check | Uso |
|-------|-----|
| `HEAD` URL pública do bot | Bot publicado |

### 2.5 Supabase

Incluído em `GET /readyz` → `supabase.connected`.

Probe dedicado opcional: dashboard Supabase → Database health.

---

## 3. Script de probe unificado

```bash
cd mdoctor-backend
node scripts/go-live-health-probe.js
```

Saída: `docs/GO-LIVE-HEALTH-PROBE.json`

Env opcionais:

```bash
BACKEND_URL=https://mdoctor-backend-staging-staging.up.railway.app
PANEL_URL=https://painel-medico-staging-staging.up.railway.app
N8N_URL=https://n8n-staging-staging-2dfe.up.railway.app
TYPEBOT_PUBLIC_URL=https://typebot.co/doctor-prescreve-8rmljgu
```

**Automação sugerida:** cron Railway / GitHub Action 15 min em staging pré-go-live.

---

## 4. Alertas mínimos (operacionais)

Sem stack APM completo — usar combinação **Railway + rotina humana + probes**.

| Alerta | Condição | Ação |
|--------|----------|------|
| Backend down | `/health` ≠ 200 por 3 min | Rollback + pausar Typebot |
| Readiness fail | `/readyz` status `fail` | Ver Supabase/JWT; não abrir fila |
| Fila parada | Nenhum atendimento novo em X h com Typebot ativo | Checar n8n webhook + secret |
| Erro Memed | Spike `memedError` / `MEMED_TIMEOUT` em audit | Voltar mock; revisar sandbox |
| Webhook 401 | `triagem_webhook_unauthorized` nos logs | Rotacionar `N8N_WEBHOOK_SECRET` |
| Falhas clínicas | Muitos 422 approve seguidos | Treinamento médico / dados triagem |

### 4.1 Railway (nativo)

- Deployment **FAILED** → notificação email/Slack do workspace.
- Métricas CPU/memória → investigar lentidão.

### 4.2 Rotina humana (2x/dia no go-live)

1. `go-live-health-probe.js`
2. Abrir fila no painel — contagem coerente
3. Amostra 3 `audit_logs` do dia

---

## 5. Correlação

Sempre propagar quando possível:

- Header `X-Correlation-Id` (painel → API)
- `correlationId` em approve/reject/validate/deliver
- `Idempotency-Key` em webhooks triagem

Facilita rastrear Typebot → n8n → backend → decisão médica.

---

## 6. Gaps (não bloquear go-live assistido, documentar)

| Gap | Mitigação go-live |
|-----|-------------------|
| Sem APM/tracing distribuído | Probe + audit + planilha diária |
| Sem alerta PagerDuty | Responsável técnico de plantão |
| Decisões log às vezes vazio em API | Confiar em `audit_logs` + GET atendimento |
| n8n webhook corpo vazio | Fallback triagem direta documentado |

---

## 7. Fase 5 — checklist rápido

- [ ] `go-live-health-probe.js` verde
- [ ] Saber onde ver `audit_logs` no Supabase
- [ ] Lista de `action` acima compreendida pela equipe
- [ ] Responsável de plantão com acesso Railway + n8n
- [ ] `docs/ROLLBACK-PLAN.md` lido e deployment baseline anotado

---

## 8. Evolução pós go-live (não fazer agora)

- Dashboard Metabase/Supabase (fila, tempos, reject reasons)
- Alertas webhook para Slack
- OpenTelemetry / Sentry no backend
- Métricas de negócio (approve rate, TMA fila)
