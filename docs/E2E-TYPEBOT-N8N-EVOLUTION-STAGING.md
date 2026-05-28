# E2E Typebot + n8n + Evolution (Staging Dry-Run)

Data/hora: 2026-05-28 12:40 -03:00

## Escopo

Validar fluxo completo em staging, sem envio real:

`Typebot staging-safe -> n8n staging -> backend staging -> Supabase -> painel -> prescription mock -> delivery dry-run Evolution`

Restricoes:

- Producao intacta
- Sem Typebot production
- Sem n8n production
- `WHATSAPP_DRY_RUN=true` mantido
- Sem mensagem real

## 1) Typebot staging-safe

Arquivo: `docs/typebot/typebot-doctor-prescreve-staging-safe.json`

Validacao automatica (`mdoctor-backend/scripts/validate-typebot-staging-safe.js`):

| Check | Resultado |
| --- | --- |
| JSON parseavel | OK |
| Webhook staging | `https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook` |
| Webhook production | nao encontrado |
| Payment block | preservado (1 bloco, nao alterado) |
| Campos clinicos/LGPD no fluxo | cobertura de hints OK (nome, telefone, cpf, nascimento, condicao, medicacao, continuo, alerta, lgpd, consentimento) |

## 2) n8n staging

Webhook ativo:

- `POST https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook`

Comportamento confirmado:

- recebe payload Typebot-like
- propaga `X-Correlation-Id` e `Idempotency-Key`
- chama backend `POST /api/whatsapp/webhook` com `X-MDoctor-Webhook-Secret`
- retorna JSON (`200`) com `atendimento.id`

## 3) Backend + Evolution dry-run

Backend staging:

- cria atendimento via webhook
- persiste Supabase
- calcula elegibilidade clinica
- registra audit logs
- mantem Evolution configurada com `dryRun=true`

Evolution staging:

- URL: `https://evolution-api-staging-staging-40d1.up.railway.app`
- Instancia: `mdoctor-staging`
- Estado: `connecting` (QR pendente; nao bloqueia dry-run)

`GET /api/whatsapp/provider-status` (amostra):

- `provider=evolution`
- `configured=true`
- `apiReachable=true`
- `instanceFound=true`
- `instanceState=connecting`
- `dryRun=true`
- `sandboxMode=true`
- `fallbackActive=true`

## 4) E2E executado

Script: `mdoctor-backend/scripts/e2e-typebot-n8n-evolution-staging.js`

Atendimento de teste (ultima execucao): `fa71be31-4488-4656-9c3f-46836f74bfa4`

| Etapa | Resultado |
| --- | --- |
| n8n webhook | `200` |
| atendimento criado | sim |
| provider-status Evolution | configurada, dry-run ativo |
| login painel/backend | `200` |
| atendimento na lista (`/api/atendimentos`) | sim |
| approve (`status=ready`) | `200` |
| prescription generate | `201`, `source=mock` |
| deliver (`POST /atendimentos/:id/deliver`) | `200`, `provider=dry-run` |
| test-send repetido em sequencia | `400` anti-spam (esperado em burst) |
| painel `/dashboard` | `200` |

Observacoes:

- Elegibilidade foi calculada; no payload E2E atual retornou inelegivel por tempo de uso (parser conservador do texto agregado).
- `test-send` em burst pode retornar `400` por `SANDBOX_MIN_INTERVAL` (protecao ativa).

## 5) Teste real

Nao executado nesta rodada.

Pre-requisitos para teste real controlado:

1. Escanear QR da instancia `mdoctor-staging` no manager Evolution
2. Confirmar `connectionState=open`
3. Autorizar desligar temporariamente `WHATSAPP_DRY_RUN`
4. Manter `WHATSAPP_SANDBOX_MODE=true`
5. Enviar para numero de teste autorizado
6. Reativar `WHATSAPP_DRY_RUN=true`

## 6) Seguranca preservada

- Rate limit webhook ativo
- Anti-spam sandbox ativo
- Audit logs ativos
- `correlationId` preservado
- Fallback/mock preservado
- Mensagem real enviada: **nao**

## Ajuste minimo aplicado no backend

`POST /api/atendimentos/:id/deliver` agora respeita `WHATSAPP_DRY_RUN` (nao forca mock quando dry-run WhatsApp esta ativo), permitindo validar `provider=dry-run` no fluxo de entrega.
