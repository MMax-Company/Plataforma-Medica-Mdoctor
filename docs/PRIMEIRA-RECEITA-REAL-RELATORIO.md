# Primeira Receita Real Supervisionada — Relatório Staging

**Data:** 2026-05-29  
**Ambiente:** staging (`mdoctor-backend-staging`, `painel-medico-staging`)  
**Script:** `mdoctor-backend/scripts/primeira-receita-real-supervisionada.js`  
**Evidência JSON:** `docs/PRIMEIRA-RECEITA-REAL-RELATORIO.json`

---

## Resumo executivo

| Item | Status |
|------|--------|
| Redeploy backend (fluxo Sinapse + status + `/api/memed/receita`) | Concluído |
| Redeploy painel | Pendente link Railway local (`railway link` no dir `mdoctor-panel`) |
| Approve sem emissão automática | Validado |
| Token Memed produção (JWT prescritor) | Validado |
| Widget Sinapse (`/receita`) | Pronto — **gate manual médico** |
| Emissão REAL Memed + PDF | **Pendente operador** |
| Persistência → validate → deliver | Pipeline técnico validado (mock); deliver corrigido pós-deploy |

**MVP operacional REAL:** **não fechado** até emissão explícita no widget Sinapse com `MEMED_RECEITA_ID` + `MEMED_PDF_URL` reais.

---

## Atendimento elegível para emissão REAL (aberto)

| Campo | Valor |
|-------|--------|
| `atendimento_id` | `525b5d0e-646d-462e-b256-265c87d05d8e` |
| Status lógico | `receita_em_edicao` |
| Doença / medicação | HAS / losartana 50mg 1x/dia |
| Receita anterior | sim (URL fictícia triagem) |
| Elegibilidade | `eligible` |
| Painel receita | https://painel-medico-staging-staging.up.railway.app/receita?atendimentoId=525b5d0e-646d-462e-b256-265c87d05d8e |

---

## Etapas automatizadas (2026-05-29)

### 1. Infra / Memed

- `GET /readyz`: Memed `configured: true`, `env: production`, `storage: supabase`
- `GET /api/memed/config`: `emissionMode: sinapse_widget_manual`
- `MEMED_ALLOW_MOCK_FALLBACK=false`

### 2. Approve clínico

- Status após approve: **`approved`** (lógico)
- `memedEmission`: `manual_sinapse_required`
- Sem `POST /prescriptions`, sem receita mock silenciosa

### 3. Iniciar emissão

- `POST /api/memed/iniciar-emissao` → `receita_em_edicao`

### 4. Token prescritor

- `GET /api/memed/token` → JWT OK (`prescriber_id: dr_max_vinicius_001`)
- **Correção aplicada:** bug `req is not defined` no handler GET `/token`

### 5. Gate manual (emissão REAL)

Operador médico deve:

1. Login no painel staging
2. Abrir URL `/receita?atendimentoId=525b5d0e-646d-462e-b256-265c87d05d8e`
3. Revisar paciente, medicação e posologia no Sinapse
4. **Emitir e imprimir** receita (ação explícita)
5. Anotar `receitaId` Memed e URL do PDF

### 6. Concluir pipeline (pós-widget)

```powershell
cd mdoctor-backend
$env:LOAD_RAILWAY_VARS="1"
$env:ATENDIMENTO_ID="525b5d0e-646d-462e-b256-265c87d05d8e"
$env:SKIP_CREATE="1"
$env:MEMED_RECEITA_ID="<id-memed-real>"
$env:MEMED_PDF_URL="<url-pdf-real>"
node scripts/primeira-receita-real-supervisionada.js
```

Esperado: `receita_emitida` → `ready` → `delivered`, `mvp_operacional_real: true`.

---

## Pipeline técnico (mock — não conta como MVP real)

Atendimento de referência: `06b7a4de-c915-4a76-b938-0c24bf61784f` (`PIPELINE_MOCK_RECEIPT=1`, 2026-05-29 23:18 UTC)

| Step | Resultado |
|------|-----------|
| approve | OK — `approved` |
| iniciar-emissao | OK — `receita_em_edicao` |
| memed token | OK |
| persist `/api/memed/receita` | OK — `receita_emitida` |
| validate | OK — `ready` |
| deliver (dry-run WhatsApp) | OK — **`delivered`** |

**Script:** `success: true`, `final_status: delivered` (evidência em `PRIMEIRA-RECEITA-REAL-RELATORIO.json`).

**Correções de persistência Supabase:**

- Status lógicos mapeados para constraint legado (`approved`→`em_atendimento`, `ready`→`APROVADO`, `delivered`→`DELIVERED`)
- `resolveEffectiveStatus` reconstrói estados a partir de `dados_clinicos`
- `medico_id` string JWT não quebra update (`resolveMedicoIdForDb`)

---

## Auditoria mínima

| Evento | Evidência |
|--------|-----------|
| Approve | decisão / audit `clinical_approved` |
| Início emissão | `memed_context.emissao_iniciada_em` |
| Persistência receita | `dados_clinicos.memed_receita` |
| Validate | `memed_receita.validated_at` |
| Deliver | `entrega_receita`, status `DELIVERED` |

Logs: audit store + decisões via `GET /api/atendimentos/:id/decisoes`.

---

## Critério MVP — checklist

- [x] Emissão explícita pelo médico (fluxo implementado; emissão real pendente)
- [ ] Persistência da receita **real** (`memed_id`, `pdf_url`, `issued_at`)
- [ ] PDF válido aberto pelo médico
- [x] Rastreabilidade (audit + decisões)
- [x] Validate OK (pipeline mock)
- [x] Deliver OK (dry-run, encerramento `delivered`)
- [ ] Encerramento completo com receita Memed real

---

## Próximo passo único

**Supervisor + médico:** emitir receita real no Sinapse para `525b5d0e-646d-462e-b256-265c87d05d8e` e reexecutar o script com IDs reais.
