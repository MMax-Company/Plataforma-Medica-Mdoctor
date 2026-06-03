# Memed Produção Controlada — Homologação

**Pré-requisito obrigatório:** `docs/SIGN-OFF-FASE3-RELATORIO.md` com gate manual **Aprovado**.

Não ativar Memed produção antes do sign-off UX médico.

**Não conectar Memed produção ao approve clínico** até este script passar com chamada real confirmada.

---

## 0. Script de validação isolada (recomendado antes do approve)

Arquivo: `mdoctor-backend/scripts/validar-memed-producao-controlada.js`

Relatório: `docs/MEMED-PRODUCAO-CONTROLADA-RELATORIO.json`

### O que o script faz

- Valida gates: `MEMED_ENABLED=true`, `MEMED_ALLOW_MOCK_FALLBACK=false`, `MEMED_ENV=production`
- Confere variáveis obrigatórias **sem imprimir secrets** (apenas present/length)
- Monta payload com **paciente fictício** (nunca paciente real)
- **Não** chama `clinical/approve`, deliver, WhatsApp ou Typebot
- **Não** altera status de atendimento (leitura opcional por `ATENDIMENTO_ID` só para estrutura)

### Passo 1 — Configurar Railway (staging)

Definir variáveis conforme seção 2 abaixo. Redeploy backend staging.

### Passo 2 — Dry-run (só env + payload)

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=1 node scripts/validar-memed-producao-controlada.js
```

Sem `MEMED_VALIDATION_CONFIRM_API=1`: valida gates, credenciais e payload; **não** chama a API Memed.

### Passo 3 — Chamada real controlada

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=1 \
MEMED_VALIDATION_CONFIRM_API=1 \
node scripts/validar-memed-producao-controlada.js
```

Opcional — persistir só em `prescriptions` (sem mudar status do atendimento):

```bash
LOAD_RAILWAY_VARS=1 \
MEMED_VALIDATION_CONFIRM_API=1 \
MEMED_VALIDATION_PERSIST=1 \
ATENDIMENTO_ID=<uuid-staging-teste> \
node scripts/validar-memed-producao-controlada.js
```

### Passo 4 — Homologar fluxo completo no painel

Seguir `docs/FLUXO-RECEITA-OFICIAL.md` e `docs/PRIMEIRA-RECEITA-REAL-RELATORIO.md`:

1. Approve → status `approved` (sem emissão automática) — **validado staging 2026-05-29**
2. Widget Sinapse em `/receita` — token JWT OK; emissão real **gate manual**
3. `POST /api/memed/receita` após impressão — persistência validada (mock pipeline)
4. Validate → `ready` — **validado**
5. Deliver controlado → `delivered` (status Supabase `DELIVERED`) — **validado dry-run**

Script automatizado:

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=1 node scripts/primeira-receita-real-supervisionada.js
# Pós-widget: MEMED_RECEITA_ID + MEMED_PDF_URL + ATENDIMENTO_ID + SKIP_CREATE=1
```

### Saída esperada (resumo no terminal)

```json
{
  "success": true,
  "environment_used": "production",
  "api_call_executed": true,
  "prescriber_auth": { "ok": true, "has_token": true, "token_valid_jwt": true },
  "prescription_api_probe": { "attempted": true, "success": false },
  "has_pdf_or_link": false,
  "persisted": false
}
```

**Critério de sucesso (isolado):** token JWT do prescritor em produção (`prescriber_auth.ok`).  
`POST /api/prescriptions` está **descontinuado** (410). Fluxo oficial: widget Sinapse + `POST /api/memed/receita`.

---

## 1. Objetivo

Substituir mock por **emissão real** Memed em operação **supervisionada**:

- 1 médico operador
- `MEMED_ALLOW_MOCK_FALLBACK=false` (falha visível, sem receita fictícia)
- entrega manual/controlada (sem WhatsApp massivo)

---

## 2. Variáveis Railway (`mdoctor-backend-staging` ou produção assistida)

```env
MEMED_ENABLED=true
MEMED_ENV=production
MEMED_ENVIRONMENT=production
# Produção: credenciais do parceiro autenticam em api.memed.com.br (integrations.* retorna 401).
MEMED_API_URL=https://api.memed.com.br/v1
MEMED_API_KEY=<produção>
MEMED_SECRET_KEY=<produção>
MEMED_TIMEOUT_MS=15000
MEMED_RETRY_ATTEMPTS=2
MEMED_ALLOW_MOCK_FALLBACK=false

MEMED_PRESCRITOR_EXTERNAL_ID=
MEMED_PRESCRITOR_NOME=
MEMED_PRESCRITOR_SOBRENOME=
MEMED_PRESCRITOR_CPF=
MEMED_PRESCRITOR_BOARD_NUMBER=
MEMED_PRESCRITOR_BOARD_STATE=
MEMED_PRESCRITOR_EMAIL=
MEMED_PRESCRITOR_TELEFONE=
```

**Nunca** commitar secrets no Git.

---

## 3. Hardening implementado (backend)

| Controle | Comportamento |
|----------|----------------|
| Retry | `MEMED_RETRY_ATTEMPTS` (default 2) com backoff curto |
| Timeout | `MEMED_TIMEOUT_MS` |
| Fallback mock | Desligado quando `MEMED_ALLOW_MOCK_FALLBACK=false` |
| Approve duplicado | HTTP 409 `CLINICAL_ALREADY_APPROVED` |
| Receita já vinculada (approve) | HTTP 409 `MEMED_PRESCRIPTION_ALREADY_EXISTS` |
| Emissão duplicada (receita) | HTTP 409 `MEMED_RECEIPT_ALREADY_EXISTS` |
| Approve **não** chama Memed REST | Emissão via widget + `POST /api/memed/receita` |

---

## 4. Procedimento de homologação

### 4.1 Readiness

```bash
# Preferir script isolado antes de approve
LOAD_RAILWAY_VARS=1 MEMED_VALIDATION_CONFIRM_API=1 \
  node mdoctor-backend/scripts/validar-memed-producao-controlada.js

curl -s https://mdoctor-backend-staging-staging.up.railway.app/readyz | jq .memed
```

Esperado: `configured: true`, `source: memed`, `env: production`.

### 4.2 Caso fictício supervisionado

Ver `docs/FLUXO-RECEITA-OFICIAL.md`.

1. Criar atendimento elegível (triagem ou Typebot controlado).
2. Médico **aprova** no painel → status `approved` (sem receita automática).
3. Abrir `/receita?atendimentoId=` → widget Sinapse → emitir 1 receita real.
4. Conferir após `POST /api/memed/receita`:
   - [ ] status `receita_emitida`
   - [ ] `memed_receita.memed_id` / `receitaId` preenchido
   - [ ] `pdfUrl` ou link Memed acessível
   - [ ] medicamento e posologia coerentes com prontuário
5. **Confirmar** (validate) → `ready`.
6. Entregar manualmente (mock/dry-run ou canal acordado).

### 4.3 Falha controlada

1. Tentar `POST /api/memed/receita` sem `receitaId` nem `pdfUrl` → **422**.
2. Tentar emissão duplicada com ID diferente → **409**.
3. Em produção: `MEMED_ALLOW_MOCK_FALLBACK=false` — sem receita mock silenciosa.

### 4.4 Rollback Memed

```env
MEMED_ENABLED=false
MEMED_ALLOW_MOCK_FALLBACK=true
```

Redeploy → volta mock estável (Fase 2).

---

## 5. Evidências a registrar

| Campo | Valor |
|-------|--------|
| atendimento_id | |
| memed prescription id | |
| pdf url | |
| médico operador | |
| data/hora | |
| supervisor presente | sim/não |

Anexar ao `docs/MVP-READY-FINAL.md`.

---

## 6. Critério de conclusão

- [ ] 1 receita **real** emitida e persistida (widget Sinapse)
- [x] JWT prescritor produção OK
- [x] Approve sem emissão automática
- [x] Pipeline persist → validate → deliver (mock / dry-run)
- [x] Falha Memed testada (502 visível, sem mock silencioso)
- [x] Approve duplicado bloqueado (409)
- [ ] Supervisor médico assinou homologação Memed com receita real
