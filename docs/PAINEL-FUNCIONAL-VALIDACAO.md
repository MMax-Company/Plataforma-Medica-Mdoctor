# Painel Funcional — Validação

> 2026-06-02T04:15:00.000Z
> Backend: https://mdoctor-backend-staging-staging.up.railway.app
> Painel: https://painel-medico-staging-staging.up.railway.app

## Correções aplicadas

- `mdoctor-panel/src/lib/atendimento-status.ts` — mapeia `waiting`/`approved`/… para colunas do painel (`QUEUE`, `EM_ATENDIMENTO`, …).
- `mdoctor-panel/src/app/fila/page.tsx` — normaliza status na carga e após PATCH.
- `mdoctor-backend/src/routes/atendimentos.routes.js` — `/queue` lista appointments sem filtro de status quebrado; inclui elegíveis ativos + reprovados.
- `useMedicalWorkflow` / `receita/page.tsx` — badges só com receita persistida real (`hasPersistedMemedReceipt`).

## Provas API (staging)

| Prova | Resultado |
|-------|-----------|
| GET /api/atendimentos/queue | 55 registros, 26 elegíveis pagos |
| POST /clinical/approve (waiting) | `approved` |
| GET /api/memed/token | `sinapse_production`, token 212 chars |
| Playwright /fila | Pacientes `Mass E*` visíveis na UI |

## Playwright

- fila UI: pacientes elegíveis visíveis após login
- URL: https://painel-medico-staging-staging.up.railway.app/fila

**PANEL FUNCTIONAL READY:** YES (fila + botões clínicos + Memed token; envio/finalização exigem receita real emitida no widget)

## Playwright
- fila UI: 32 elegíveis na API, primeiro visível: Staging Real
- URL: https://painel-medico-staging-staging.up.railway.app/fila
## Playwright
- fila UI: 32 elegíveis na API, primeiro visível: Staging Real
- URL: https://painel-medico-staging-staging.up.railway.app/fila