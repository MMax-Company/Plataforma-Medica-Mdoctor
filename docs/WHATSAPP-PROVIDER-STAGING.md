# WhatsApp Provider Staging Preparation

Data/hora: 2026-05-28 07:38 -03:00

## Status

- Provider WhatsApp definido/configurado no staging: **nao**
- Provider ativado em staging: **nao**
- Fluxo de entrega atual: **mock controlado** (`provider=mock`)

## Provider Candidates

- WhatsApp Cloud API
- Evolution API
- Z-API
- UltraMSG
- Outro (com adaptador dedicado)

No estado atual, nenhum destes provedores foi configurado no backend staging.

## Contract for Delivery Send (target state)

Campos minimos para envio controlado:

- `destinatario` (telefone em formato E.164)
- `mensagem` (texto final enviado)
- `link_pdf_receita` ou `receiptUrl`
- `status_envio` (`queued|sent|failed|delivered`)
- `erro` (quando aplicavel)
- `retry` (tentativa atual e politica)
- `correlationId` (rastreio ponta a ponta)
- `audit_log` (evento de envio/falha/retentativa)

## Controlled Flow (staging)

1. n8n recebe evento.
2. n8n chama `POST /api/whatsapp/webhook` com:
   - `X-MDoctor-Webhook-Secret`
   - `X-Correlation-Id`
   - `Idempotency-Key`
3. Backend cria atendimento.
4. Painel exibe atendimento.
5. Delivery chama `POST /api/atendimentos/:id/deliver`.
6. Sem provider real configurado, backend usa `mock` controlado.
7. Status final esperado: `delivered` (mock).

## Fallback Requirement

- Fallback mock deve permanecer habilitado enquanto provider real nao estiver configurado e validado.
- Se provider real falhar, fluxo deve retornar para comportamento controlado sem interromper o MVP de staging.

## Blocking Requirements to Enable Real Provider

1. Definir provider oficial para staging (um dos candidatos).
2. Provisionar credenciais **somente staging** (nunca production).
3. Configurar variaveis no backend/n8n staging sem expor segredos.
4. Garantir dominio/numero de teste (nunca dominio oficial de producao).
5. Executar smoke tests:
   - envio sucesso
   - erro controlado
   - retry com idempotencia
   - audit logs e correlationId
6. Aprovar cutover controlado antes de qualquer ativacao real.

## Out of Scope

- Ativar Stripe
- Ativar Memed producao
- Ativar provider WhatsApp em producao
