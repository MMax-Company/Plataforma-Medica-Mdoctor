# Fluxo Oficial da Receita — Doctor Prescreve

Documento canônico do ciclo clínico da receita digital com Memed Sinapse.

---

## Pipeline

```text
triagem
  → fila (waiting)
  → prontuário / atendimento (em_atendimento)
  → POST /api/atendimentos/:id/clinical/approve  → approved
  → POST /api/memed/iniciar-emissao              → receita_em_edicao
  → widget Sinapse (painel /receita)
  → médico revisa e confirma impressão
  → POST /api/memed/receita                      → receita_emitida
  → POST /api/atendimentos/:id/clinical/validate → ready
  → POST /api/atendimentos/:id/deliver           → delivered
```

---

## Regras de ouro

| Regra | Implementação |
|-------|----------------|
| **Fluxo único de emissão** | Painel → widget Memed/Sinapse → médico emite na Memed → callback → `POST /api/memed/receita` |
| Doctor Prescreve **não** assina, **não** emite sozinho, **não** usa certificado próprio | Assinatura Bird ID apenas no widget |
| Approve **não** emite receita | `clinical-decision.service.js` — status `approved`, sem REST de prescrição |
| Emissão só com ação explícita do médico | Botão no painel + widget Sinapse + `prescricaoImpressa` |
| Persistência oficial | `POST /api/memed/receita` |
| `POST /api/prescriptions` | **Descontinuado** (HTTP 410) — nunca foi fluxo oficial |
| Sem mock silencioso em produção | `MEMED_ALLOW_MOCK_FALLBACK=false` |
| Duplicate approve bloqueado | HTTP 409 `CLINICAL_ALREADY_APPROVED` |
| Duplicate emissão bloqueada | HTTP 409 `MEMED_RECEIPT_ALREADY_EXISTS` |
| Deliver só após validação | Status `ready` + `memed_receita.validated_at` |

---

## Estados clínicos

| Status | Significado | Próxima ação médica |
|--------|-------------|---------------------|
| `waiting` | Fila / triagem concluída | Abrir prontuário |
| `em_atendimento` | Em avaliação | Aprovar ou reprovar |
| `approved` | Decisão clínica positiva | **Emitir receita** (Memed) |
| `receita_em_edicao` | Widget aberto | Revisar e imprimir na Memed |
| `receita_emitida` | Receita vinculada | **Confirmar** (validate → ready) |
| `ready` | Validada | Entregar (controlado) |
| `delivered` | Enviada ao paciente | Terminal |
| `rejected` | Reprovado | Terminal |

Aliases legados: `memed_processing` / `AWAITING_VALIDATION` → tratados como `receita_emitida`.

---

## Endpoints

### Approve clínico

`POST /api/atendimentos/:id/clinical/approve`

- Valida elegibilidade, foto de receita anterior, duplicate approve
- Persiste audit `clinical_approved`
- **Não** chama Memed REST

### Iniciar emissão

`POST /api/memed/iniciar-emissao`

Body: `{ "atendimentoId": "<uuid>" }`

- Requer status `approved` ou `receita_em_edicao`
- Transição → `receita_em_edicao`
- Audit: `memed_emission_started`

### Persistir receita emitida

`POST /api/memed/receita`

Body mínimo:

```json
{
  "atendimentoId": "<uuid>",
  "receitaId": "<memed_id>",
  "pdfUrl": "https://...",
  "payload": {}
}
```

Persiste:

- `memed_id` / `receitaId`
- `pdf_url` / `receitaUrl`
- `issued_at` / `gerada_em`
- `prescriber` (snapshot env)
- `payload_summary` + row em `prescriptions`
- Audit: `memed_receipt_persisted`

### Validar

`POST /api/atendimentos/:id/clinical/validate`

- Requer `receita_emitida` + receita vinculada
- Transição → `ready`

### Entregar

`POST /api/atendimentos/:id/deliver`

- Requer `ready` + `validated_at`

---

## Painel médico

| Tela | Função |
|------|--------|
| `/atendimento/[id]` | Prontuário, approve/reject, atalhos Memed |
| `/receita?atendimentoId=` | Widget Sinapse, botão **Emitir Receita** |
| `/prontuario/[id]` | Approve → redirect `/receita` |

Feedback visual:

- Status pill por fase (`approved`, `receita_em_edicao`, `receita_emitida`, `ready`)
- Erros Memed visíveis (token, persistência)
- Link **Validar receita** após persistência

---

## Homologação final (staging)

1. Triagem fictícia → atendimento elegível
2. Approve clínico → `approved`
3. Abrir `/receita` → widget Sinapse → 1 receita real supervisionada
4. Confirmar persistência → `receita_emitida`
5. Validate → `ready`
6. Deliver controlado (mock/dry-run)

E2E automatizado (mock receipt): `node mdoctor-backend/scripts/fechar-fase2-staging.js`

Validação Memed produção isolada: `node mdoctor-backend/scripts/validar-memed-producao-controlada.js`

---

## Fora de escopo deste MVP

- WhatsApp automático em massa
- Múltiplos médicos simultâneos
- Billing avançado
- Emissão ou assinatura fora do widget Memed (`POST /api/prescriptions`, certificado no Doctor Prescreve)
