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

## Seguranca

Na auditoria dos arquivos pendentes, nao foi encontrado segredo real nem variavel `.env` real exposta. Os trechos usam `process.env`.

Antes de qualquer integracao real de Stripe, Typebot ou WhatsApp, estes arquivos devem ser reavaliados.
