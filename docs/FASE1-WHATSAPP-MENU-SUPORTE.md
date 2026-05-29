# Fase 1 — Menu WhatsApp e Suporte Humano

Data: 2026-05-29

## Escopo implementado

1. **Menu inicial WhatsApp** (Evolution → n8n) com opções:
   - `1` — ATENDIMENTO MÉDICO ONLINE → link Typebot oficial
   - `2` — FALAR COM EQUIPE / SUPORTE → fila humana no painel
2. **Suporte humano** separado da fila médica (`dados_clinicos.queue_type = support`)
3. **Painel** — faixa **SUPORTE MÉDICO VIA WHATSAPP** acima das 3 colunas médicas
4. **Typebot** — uso do bot existente `doctor-prescreve-8rmljgu` (sem recriar fluxo)

## Arquivos principais

| Área | Arquivo |
| --- | --- |
| Menu n8n (fonte) | `docs/n8n-workflows/lib/whatsapp-inbound-menu.code.js` |
| Workflow n8n | `docs/n8n-workflows/evolution-webhook-staging.json` |
| Backend suporte | `mdoctor-backend/src/services/whatsapp-support.service.js` |
| API suporte | `POST /api/whatsapp/support`, `POST /api/whatsapp/support/close` |
| Fila painel | `GET /api/atendimentos/support-queue` |
| Painel UI | `mdoctor-panel/src/components/dashboard/SupportWhatsappBand.tsx` |

## Variáveis n8n staging (configurar no Railway)

| Variável | Uso |
| --- | --- |
| `EVOLUTION_API_URL` | Envio de texto WhatsApp |
| `EVOLUTION_API_KEY` ou `AUTHENTICATION_API_KEY` | Auth Evolution |
| `EVOLUTION_INSTANCE` | `mdoctor-staging` |
| `BACKEND_URL_STAGING` | Backend staging |
| `N8N_WEBHOOK_SECRET` | Chamadas ao backend |
| `TYPEBOT_PUBLIC_ID` | `doctor-prescreve-8rmljgu` |
| `TYPEBOT_PUBLIC_URL` | `https://typebot.co/doctor-prescreve-8rmljgu` |

## Typebot API (workspace)

- Workspace ID: `cmmhv3b27000204lbqnb1sdyp`
- Bot principal: `higij2z0xihxxkr378rmljgu` — publicId `doctor-prescreve-8rmljgu`
- Token: configurar apenas em Railway/local como `TYPEBOT_API_TOKEN` — **nunca commitar**

## Deploy n8n após alteração

```bash
N8N_WORKFLOW_FILE=docs/n8n-workflows/evolution-webhook-staging.json node mdoctor-backend/scripts/n8n-activate-workflow.js
```

## Validação manual

1. Enviar mensagem qualquer no WhatsApp conectado → receber menu
2. Responder `1` → receber link Typebot
3. Responder `2` → mensagem de aguarde + entrada na faixa de suporte no painel
4. Em suporte: `0` volta ao menu; `ENCERRAR` fecha ticket
5. Fila médica (3 colunas) não deve listar pacientes de suporte

## Preservado

- Webhook Typebot → backend (`typebot-webhook-staging.json`)
- Bridge `STAGING_E2E_COMPLETE` para testes
- Dry-run / Evolution staging
- Layout principal do painel (apenas faixa adicional)
