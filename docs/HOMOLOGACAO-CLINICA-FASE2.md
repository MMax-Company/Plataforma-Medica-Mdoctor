# Homologação Clínica — Fase 2 (Operacional)

Validação do **ciclo médico completo** em **staging**, sem Memed/WhatsApp/Stripe de produção.

## Ambiente obrigatório

| Componente | URL |
|------------|-----|
| Backend | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel | `https://painel-medico-staging-staging.up.railway.app` |
| n8n staging | `https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook` |

**Não** homologar decisões clínicas inicialmente em produção.

---

## Fluxos homologados

### Fluxo 1 — Aprovação

```text
waiting → POST clinical/approve → memed_processing
       → POST clinical/validate → ready
       → POST deliver → delivered (mock)
```

### Fluxo 2 — Reprovação

```text
waiting → POST clinical/reject (reason_code) → rejected
       → motivo_rejeicao persistido + audit log
```

---

## Motivos estruturados de reprovação

| `reason_code` | Uso |
|---------------|-----|
| `RED_FLAG` | Sinal de alerta |
| `DOCUMENTACAO_INSUFICIENTE` | Prontuário/anexos insuficientes |
| `RECEITA_AUSENTE` | Sem receita anterior válida |
| `FORA_DO_PROTOCOLO` | Fora do protocolo de renovação |
| `MEDICACAO_INCOMPATIVEL` | Medicação incompatível |
| `RISCO_CLINICO` | Risco elevado |
| `DADOS_INCONSISTENTES` | Dados inconsistentes |
| `OUTROS` | Exige texto em `motivo` / observações (mín. 5 caracteres) |

**API**

- `GET /api/atendimentos/clinical/reject-reasons` (auth)
- `POST /api/atendimentos/:id/clinical/reject` — body: `{ "reason_code": "...", "motivo": "..." }`

Persistência: `dados_clinicos.motivo_rejeicao`, `clinical_audit.rejectReasonCode`, decisão log + `createAuditLog` (`clinical_rejected`).

---

## Endpoints do ciclo

| Etapa | Método | Rota |
|-------|--------|------|
| Aprovar | POST | `/api/atendimentos/:id/clinical/approve` |
| Reprovar | POST | `/api/atendimentos/:id/clinical/reject` |
| Validar (ready) | POST | `/api/atendimentos/:id/clinical/validate` |
| Entregar (mock) | POST | `/api/atendimentos/:id/deliver` |

Memed: mock quando `MEMED_ENABLED=false` (staging). Entrega: mock quando `DELIVERY_MOCK_ENABLED=true` ou ambiente não-produção.

---

## Checklist painel staging (manual)

Abrir `/atendimento/{id}` ou `/prontuario/{id}`:

- [ ] Doença / condição visível
- [ ] Medicação e posologia
- [ ] Conduta e orientações
- [ ] Exame telemedicina
- [ ] Receita anterior (visualizar)
- [ ] Pagamento confirmado
- [ ] Elegibilidade e risco
- [ ] Aprovar → status `memed_processing`
- [ ] Reprovar com motivo estruturado → `rejected`
- [ ] Validar receita → `ready`
- [ ] Entregar → `delivered` (mock)

---

## Scripts E2E (automático)

```bash
cd mdoctor-backend

# Ciclo completo (approve + deliver + segundo atendimento reject)
BACKEND_URL=https://mdoctor-backend-staging-staging.up.railway.app \
N8N_WEBHOOK_SECRET=... \
MEDICO_USER=... MEDICO_PASS=... \
  node scripts/homologacao-clinica-fase2-e2e.js

# Fluxos isolados
FLOW=approve node scripts/homologacao-clinica-fase2-e2e.js
FLOW=reject  node scripts/homologacao-clinica-fase2-e2e.js
FLOW=ready   ATENDIMENTO_ID=... node scripts/homologacao-clinica-fase2-e2e.js
FLOW=deliver ATENDIMENTO_ID=... node scripts/homologacao-clinica-fase2-e2e.js
FLOW=memed   node scripts/homologacao-clinica-fase2-e2e.js
```

Atalhos: `homologacao-clinica-fase2-approve-flow.js`, `-reject-flow.js`, `-ready-flow.js`, `-deliver-flow.js`, `-memed-mock-flow.js`.

Relatório: `docs/HOMOLOGACAO-CLINICA-FASE2-RELATORIO.json`

---

## Auditoria mínima (Fase 2)

Registrado em `audit` store e `decisoes`:

- médico (`approvedBy` / `rejectedBy`)
- timestamps
- `reason_code` na reprovação
- `correlationId`
- resumo Memed mock / entrega mock

Sem auditoria avançada/LGPD nesta fase.

---

## Critérios de conclusão

- [x] Abertura de atendimento OK (triagem staging + painel deploy)
- [x] Approve + Memed mock + validate + deliver repetíveis via script (`fechar-fase2-staging.js`)
- [x] Reject com `reason_code` persistido
- [x] `GET /clinical/reject-reasons` — 8 códigos
- [x] Logs/audit mínimos (`clinical_approved`, `memed_prescription_validated`, `delivery_completed`, `clinical_rejected`)
- [x] Relatório: `docs/HOMOLOGACAO-CLINICA-FASE2-RELATORIO.json` (2026-05-29, `success: true`)

**IDs de evidência (staging):**

- Approve → deliver: `11ccc0ac-fc66-42ad-b266-4009ebdf39db`
- Reject: `a930e2af-2652-4487-9918-d8f9dfdf0a89`

Sign-off manual rápido no painel (`/fila`, `/atendimento/{id}`, `/prontuario/{id}`) recomendado após deploy.

---

## Fora de escopo (Fase 2)

Memed produção, WhatsApp produção, Stripe produção, billing, automações avançadas, LGPD avançada, multi-tenant, redesign visual.
