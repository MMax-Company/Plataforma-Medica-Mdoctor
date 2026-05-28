# Pendencias de Pagamentos e WhatsApp

Este documento registra alteracoes pendentes auditadas e deixadas fora do MVP/staging atual.

## Arquivos auditados

- `mdoctor-backend/server.js`
- `mdoctor-backend/src/routes/whatsapp.routes.js`
- `mdoctor-backend/src/routes/payments.routes.js`

## Riscos

| Arquivo | Risco | Observacao |
| --- | --- | --- |
| `mdoctor-backend/server.js` | alto | Montava rotas de pagamentos e webhook Stripe, ampliando a superficie do backend. |
| `mdoctor-backend/src/routes/whatsapp.routes.js` | medio/alto | Alterava o fluxo WhatsApp para depender de pagamento antes da fila medica. |
| `mdoctor-backend/src/routes/payments.routes.js` | alto | Introduzia checkout Stripe, webhook Stripe e confirmacao Typebot ainda nao validados para o MVP atual. |

## Decisao

Estas alteracoes nao devem entrar no MVP/staging atual.

Pagamentos, WhatsApp, Stripe e Typebot devem ser revisados depois em uma fase propria, com planejamento, testes locais, staging seguro e validacao de contratos externos.

## Separacao obrigatoria de trilhas

Para o staging atual, manter trilhas independentes:

- Trilha A: WhatsApp/n8n para entrada de webhook e entrega mock/controlada.
- Trilha B: pagamentos/Stripe.

Regras:

- Nao acoplar recebimento de webhook WhatsApp com confirmacao de pagamento Stripe.
- Nao bloquear fila medica por dependencia de checkout Stripe nesta fase.
- Nao reutilizar credenciais/webhooks de producao em staging.

## Estado validado em staging (whatsapp sem pagamentos)

Fluxos ja funcionais e seguros no backend staging:

- `GET /api/whatsapp/status` responde com status operacional.
- `POST /api/whatsapp/webhook` cria atendimento em fila medica.
- `POST /api/atendimentos/:id/deliver` com `channel=whatsapp` entrega em modo mock.
- Atendimento evolui para `delivered`.
- Registros de auditoria e entrega sao persistidos no Supabase staging.

## O que ainda falta para n8n "pronto"

- Definir contrato formal de payload entre n8n e `POST /api/whatsapp/webhook`.
- Definir autenticacao/assinatura de webhook para origem n8n.
- Definir estrategia de retry/idempotencia para mensagens duplicadas.
- Definir observabilidade operacional (correlation id e rastreio fim a fim).

Conclusao:

- WhatsApp staging mock/controlado: pronto para testes tecnicos.
- Pagamentos/Stripe: fora de escopo desta trilha e nao ativados.

## Seguranca

Na auditoria dos arquivos pendentes, nao foi encontrado segredo real nem variavel `.env` real exposta. Os trechos usam `process.env`.

Antes de qualquer integracao real de Stripe, Typebot ou WhatsApp, estes arquivos devem ser reavaliados.
