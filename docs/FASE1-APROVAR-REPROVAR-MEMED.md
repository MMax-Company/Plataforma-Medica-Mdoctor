# Fase 1 — Pedido 2/3: Aprovar, Reprovar e Memed

## Fluxo implementado

### Reprovar (prontuário → backend → n8n → WhatsApp)

1. Painel chama `POST /api/atendimentos/:id/clinical/reject` com observação opcional.
2. Backend salva prontuário, decisão, médico, timestamp e status `rejected`.
3. Backend **não** aciona Memed (`memed_bloqueado: true`).
4. Backend dispara webhook n8n `clinical-rejection-notify` com mensagem padrão.
5. n8n envia WhatsApp via Evolution (respeita `WHATSAPP_DRY_RUN`).

Mensagem padrão:

> Após avaliação médica, não foi possível aprovar sua renovação de receita por teleconsulta. Recomendamos atendimento presencial para melhor avaliação.

### Aprovar (prontuário → backend → Memed → coluna Em atendimento)

1. Painel chama `POST /api/atendimentos/:id/clinical/approve` com conduta e observação.
2. Backend salva prontuário + auditoria (`clinical_audit.decision = approved`).
3. Backend aciona `memed.createPrescription` (mock em staging se Memed desligada).
4. Status vai para `memed_processing` (coluna **Em atendimento** no painel).
5. Painel redireciona para `/memed/:id` para validação visual.
6. Aceite na tela Memed → `PATCH /api/atendimentos/:id/status` com `ready`.

## Variáveis (staging)

| Variável | Uso |
|----------|-----|
| `N8N_WEBHOOK_SECRET` | Secret compartilhado backend ↔ n8n |
| `N8N_CLINICAL_REJECT_WEBHOOK_URL` | URL do webhook (default: substitui `typebot-webhook` por `clinical-rejection-notify`) |
| `WHATSAPP_DRY_RUN=true` | n8n não envia texto real; registra dry-run |
| `MEMED_ENABLED=false` | Memed mock no backend |

## Publicar workflow n8n

```bash
cd mdoctor-backend
N8N_WORKFLOW_FILE=../docs/n8n-workflows/clinical-rejection-notify-staging.json \
N8N_API_KEY=<sua-chave> \
node scripts/deploy-n8n-workflow.js

N8N_WORKFLOW_FILE=../docs/n8n-workflows/clinical-rejection-notify-staging.json \
node scripts/n8n-activate-workflow.js
```

URL esperada: `https://<n8n-staging>/webhook/clinical-rejection-notify`

## Teste rápido local

```bash
# Reprovar (com token JWT do painel)
curl -X POST http://localhost:3004/api/atendimentos/<ID>/clinical/reject \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"notes":"Contraindicação relatada"}'

# Aprovar
curl -X POST http://localhost:3004/api/atendimentos/<ID>/clinical/approve \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"conduta_medica":"Renovar por 30 dias"}'
```

## Arquivos principais

- `mdoctor-backend/src/services/clinical-decision.service.js`
- `mdoctor-backend/src/services/n8n-clinical-notify.service.js`
- `mdoctor-backend/src/routes/atendimentos.routes.js` (rotas `clinical/approve` e `clinical/reject`)
- `mdoctor-panel/src/services/clinical-decision.ts`
- `mdoctor-panel/src/app/prontuario/[id]/page.tsx`
- `docs/n8n-workflows/clinical-rejection-notify-staging.json`
