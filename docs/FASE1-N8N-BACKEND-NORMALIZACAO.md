# Fase 1 — Pedido 3/3: n8n, normalização e backend

## Fluxo

`Typebot` → `n8n (typebot-webhook-staging)` → `POST /api/whatsapp/webhook` → painel (`GET /api/atendimentos?scope=medical`)

Suporte WhatsApp permanece em rotas/filas separadas (`queue_type: support`).

## n8n

- Workflow: `docs/n8n-workflows/typebot-webhook-staging.json`
- Code node: `docs/n8n-workflows/lib/typebot-webhook-payload.code.js`
- Embutir após editar lib:
  ```bash
  node mdoctor-backend/scripts/embed-n8n-typebot-payload.js
  ```

### Normalizações no n8n

| Campo | Regra |
|-------|--------|
| `birth_date` | `dd/mm/aaaa`, `ddmmaaaa`, `dd-mm-aaaa` → `yyyy-mm-dd` |
| `cpf` | só dígitos (11) |
| `whatsapp` | E.164 `+55...` |
| `email` | lowercase válido |
| `cep` | 8 dígitos |
| `chronic_condition` | HAS/DM2/DLP/hipotireoidismo |
| `medications` | até 3 itens estruturados |
| `payment_status` | `paid` / `unpaid` |
| `eligibility_status` | `eligible` / `ineligible` + motivo |

Exemplo posologia:
- Entrada: `metformina 850 tomo 2x ao dia`
- Saída: nome, dose, unidade, via oral, frequência `12/12h`, posologia textual

## Backend

- `src/services/clinical-payload-normalizer.service.js` — normalização + validação final
- `src/services/typebot-payload.mapper.js` — adaptador do webhook
- `src/routes/whatsapp.routes.js` — bloqueio pagamento/elegibilidade antes da fila
- `src/routes/atendimentos.routes.js` — `scope=medical` só exibe casos pagos+elegíveis

### Regras da fila médica

Entra na fila (`STATUS.QUEUE`) somente se:

- `eligibility_status = eligible`
- `payment_status = paid` (`pagamento_status = CONFIRMADO`)
- receita anterior + foto presentes
- protocolo permitido
- sem sinais de alerta / medicamento controlado
- campos obrigatórios completos

Caso contrário: `rejected`, **não aparece** no painel médico (inclui pagamento pendente).

## Payload limpo (exemplo)

```json
{
  "patient_name": "Ana Silva",
  "birth_date": "1988-02-09",
  "cpf": "12345678909",
  "whatsapp": "+5511999990000",
  "email": "ana@example.com",
  "address": "Rua A, 100",
  "cep": "01310100",
  "chronic_condition": "hipertensao",
  "medication_count": 1,
  "medications": [{ "name": "Metformina", "dose": "850", "unit": "mg", "route": "oral", "frequency": "12/12h" }],
  "previous_prescription_file": "https://...",
  "has_previous_prescription": true,
  "has_warning_signs": false,
  "eligibility_status": "eligible",
  "ineligibility_reason": null,
  "payment_status": "paid",
  "protocol": "staging-clinical-v1",
  "source": "typebot",
  "correlation_id": "typebot-...",
  "queue_type": "medical"
}
```

## Testes locais

```bash
node mdoctor-backend/scripts/test-fase1-payload-normalizer.js
node mdoctor-backend/scripts/test-typebot-eligibility.js
```

## Deploy

1. Republicar workflow n8n staging (`typebot-webhook-staging`)
2. Redeploy backend staging
3. Validar E2E: `node mdoctor-backend/scripts/e2e-typebot-n8n-evolution-staging.js`
