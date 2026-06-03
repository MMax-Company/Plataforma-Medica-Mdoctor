# Runbook — Homologação clínica Fase 2

Operação supervisionada do ciclo **aprovar → Memed mock → ready → entregar** e **reprovar com motivo**, somente em **staging**.

---

## Pré-requisitos

| Variável | Descrição |
|----------|-----------|
| `BACKEND_URL` | `https://mdoctor-backend-staging-staging.up.railway.app` |
| `N8N_WEBHOOK_URL` | Webhook typebot staging |
| `N8N_WEBHOOK_SECRET` | Secret do webhook (Railway staging) |
| `MEDICO_USER` / `MEDICO_PASS` | Médico de teste no staging |
| Painel | Login em `painel-medico-staging-staging` |

Confirmar no Railway (backend staging):

- `MEMED_ENABLED=false` (mock)
- `DELIVERY_MOCK_ENABLED=true` (recomendado)

---

## 1. Fechamento E2E (recomendado)

```powershell
cd mdoctor-backend
node scripts/fechar-fase2-staging.js
```

Carrega vars do Railway (`mdoctor-backend-staging`), cria atendimentos via `POST /api/webhook/triagem`, executa approve/validate/deliver + reject, grava `docs/HOMOLOGACAO-CLINICA-FASE2-RELATORIO.json`.

Última execução: **2026-05-29** — `success: true`.

Alternativa manual de vars:

```powershell
$env:BACKEND_URL="https://mdoctor-backend-staging-staging.up.railway.app"
$env:N8N_WEBHOOK_SECRET="<secret>"
$env:MEDICO_USER="staging-doctor"
$env:MEDICO_PASS="<pass>"
node scripts/homologacao-clinica-fase2-e2e.js
```

Passos no relatório:

1. `login` — 200
2. `n8n_create_atendimento` — atendimentoId
3. `clinical_approve` — status `memed_processing`
4. `memed_mock_persisted` — `dados_clinicos.memed_receita`
5. `clinical_validate_ready` — status `ready`
6. `deliver_mock` — provider `mock`, status final `delivered`
7. (full) `clinical_reject` — segundo atendimento `rejected`

---

## 2. Fluxo manual no painel

1. Login staging → `/fila`.
2. Abrir atendimento de teste (Typebot/n8n).
3. Conferir checklist do prontuário (doença, medicação, posologia, conduta, orientações, exame telemedicina, receita, pagamento).
4. **Aprovar** — deve ir para Memed/receita sem `PATCH /status`.
5. Abrir receita → **Aceitar/validar** → status `ready`.
6. Enviar por canal (WhatsApp mock) → `delivered`.

Reprovação:

1. Novo atendimento de teste.
2. Selecionar motivo no dropdown.
3. **Reprovar** — status `rejected`; conferir histórico/decisões.

---

## 3. Testes isolados por etapa

```powershell
# Só approve + Memed mock
node scripts/homologacao-clinica-fase2-memed-mock-flow.js

# Só reject (cria atendimento novo)
node scripts/homologacao-clinica-fase2-reject-flow.js

# Ready / deliver em ID existente
$env:ATENDIMENTO_ID="<uuid>"
node scripts/homologacao-clinica-fase2-ready-flow.js
node scripts/homologacao-clinica-fase2-deliver-flow.js
```

---

## 4. Verificação de motivos (API)

```http
GET /api/atendimentos/clinical/reject-reasons
Authorization: Bearer <token>
```

```http
POST /api/atendimentos/:id/clinical/reject
Content-Type: application/json

{
  "reason_code": "DOCUMENTACAO_INSUFICIENTE",
  "motivo": "Laudo incompleto na triagem"
}
```

Conferir no `GET /api/atendimentos/:id`:

- `dados_clinicos.motivo_rejeicao.code`
- `dados_clinicos.clinical_audit.rejectReasonCode`

---

## 5. Troubleshooting

| Sintoma | Ação |
|---------|------|
| approve 422 | Verificar receita anterior + foto + elegibilidade/pagamento |
| reject 400 | Enviar `reason_code` válido; `OUTROS` exige motivo ≥ 5 chars |
| deliver 422 | Atendimento precisa estar `ready` com `memed_receita.pdfUrl` |
| n8n sem ID | Conferir `N8N_WEBHOOK_SECRET` e workflow staging ativo |
| painel ainda usa PATCH status | Deploy painel staging com Fase 2 (clinical endpoints) |

---

## 6. Encerramento da Fase 2

Marcar concluída quando:

- E2E `full` verde em staging
- Checklist manual assinado (operador)
- Relatório JSON arquivado
- Nenhum bloqueador em approve/reject/deliver mock

Próxima fase sugerida: integração Memed real em ambiente controlado (fora deste escopo).
