# Primeiro teste real completo — relatório

**Data:** 2026-06-03  
**Script:** `scripts/primeiro-teste-real-completo.js`  
**Resultado:** **success: true** (após correção Railway; run `REAL-1780474747664`)

**Outbound real:** Evolution `sendText` → HTTP **201** para o paciente do teste.

## Correção aplicada (bloqueante)

| Problema | Causa | Correção |
|----------|--------|----------|
| `typebot-webhook` HTTP 200 sem `atendimentoId` | `BACKEND_BASE_URL` no n8n apontava para `doctor-repositorio-central-production` (404 em `/api/webhook/triagem`) | Railway `n8n Node`: `BACKEND_BASE_URL` e `BACKEND_URL_STAGING` → `https://mdoctor-backend-staging-staging.up.railway.app` + redeploy |

## Fases validadas

| Fase | OK |
|------|-----|
| Evolution open + modo discreto (counts 0) | Sim |
| Webhooks evolution + typebot 200 | Sim |
| Backend health + Supabase readyz | Sim |
| WhatsApp simulado: menu → opção 1 → triagem E2E → suporte | Sim |
| Typebot → n8n → backend (`atendimentoId` retornado) | Sim |
| Idempotência (sem duplicar) | Sim |
| Painel: login, fila, detalhe atendimento | Sim |
| Recovery probe pós-fluxo | Sim |

## Teste manual ainda recomendado

- Mensagem física no celular para o número conectado
- Completar Typebot publicado no browser (fluxo visual)
- Reconnect QR após restart Evolution (se `state` ≠ `open`)

## Comandos

```bash
node scripts/check-production-health.js
node scripts/primeiro-teste-real-completo.js
```

JSON detalhado: `docs/PRIMEIRO-TESTE-REAL-RELATORIO.json` (gerado a cada execução).
