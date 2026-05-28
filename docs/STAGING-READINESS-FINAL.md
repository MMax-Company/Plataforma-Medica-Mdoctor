# Staging Readiness Final - Doctor Prescreve

Data/hora: 2026-05-28 07:30 -03:00

## Objetivo

Confirmar prontidao do staging para integracao n8n real controlada, sem ativar componentes reais fora de escopo.

## Arquitetura Atual (staging)

- Backend: `https://mdoctor-backend-staging-staging.up.railway.app`
- Painel: `https://painel-medico-staging-staging.up.railway.app`
- Persistencia: Supabase real (`storage.mode=supabase`, `supabase.connected=true`)
- Integracao WhatsApp: webhook backend seguro, sem provider real ativo
- Entrega de receita: modo mock controlado no backend

## Componentes Ativos

- API backend staging operacional:
  - `GET /health`
  - `GET /readyz`
  - `GET /api/whatsapp/status`
  - `POST /api/whatsapp/webhook`
  - `POST /api/atendimentos/:id/deliver` (com auth)
- Painel staging acessivel:
  - `/login`
  - `/dashboard`
- Seguranca webhook:
  - `X-MDoctor-Webhook-Secret`
- Protecoes e rastreabilidade:
  - Rate limit por IP (`429`)
  - Idempotencia (`Idempotency-Key` / `rawMessage.messageId`)
  - Correlation tracing (`X-Correlation-Id`)
  - `audit_logs` no Supabase

## Componentes em Mock/Fora de Escopo

- WhatsApp provider real: desativado
- Delivery real (Twilio/Resend): desativado
- Memed real/producao: desativado (mock ativo)
- Stripe/pagamentos: desativado e fora desta fase

## Validacao Final de Estado

- Backend:
  - `/health`: OK
  - `/readyz`: OK com `mode=supabase`, `fallback_local=false`
  - `/api/whatsapp/status`: OK
- Painel:
  - `/login`: 200
  - `/dashboard`: 200
- Persistencia:
  - atendimento, audit logs e status final `delivered` persistindo apos restart do backend staging
- Webhook flow:
  - auth por header: OK
  - idempotencia: OK (`duplicate=true` no reenvio)
  - rate limit: OK (`429` em burst)
  - correlation tracing: OK (header/response/audit)

## Pendencias Bloqueantes

### Para integracao n8n real controlada

- Nenhuma pendencia bloqueante tecnica no backend staging para iniciar integracao controlada do webhook n8n.
- Condicoes obrigatorias operacionais:
  - n8n deve enviar `X-MDoctor-Webhook-Secret`
  - n8n deve enviar `X-Correlation-Id`
  - n8n deve enviar `Idempotency-Key`
  - retry deve respeitar idempotencia e limites (`429`)

### Para WhatsApp provider staging real

- Bloqueante: credenciais/provider reais ainda nao configurados por decisao de seguranca.
- Bloqueante: estrategia de hardening adicional (assinatura HMAC/timestamp/allowlist) ainda pendente para fase de provider real.

### Para delivery real futuro

- Bloqueante: provider real (Twilio/Resend) nao configurado no staging.
- Bloqueante: plano operacional de erros/retry/custos e monitoracao para envio real.

## Riscos Restantes

- `CORS_ORIGIN=*` no staging: aceitavel para fase tecnica, mas nao recomendado para endurecimento final.
- `NODE_ENV=staging` e checks de warning em `/readyz`: esperado para ambiente de homologacao, nao para producao.
- Dependencia de segredo compartilhado para webhook: seguro para minimo viavel, mas inferior a assinatura criptografica.

## Proximos Passos Reais

1. Conectar workflow n8n real ao webhook staging usando contrato documentado.
2. Configurar observabilidade n8n (logs por `correlationId`, alertas por `401/429/5xx`).
3. Executar bateria controlada com volume baixo e validacao de idempotencia/retry.
4. Planejar hardening de webhook (assinatura/timestamp/allowlist) antes de provider real.
5. Planejar ativacao separada de provider real de delivery em fase propria.

## Rollback Basico

Se qualquer comportamento inesperado ocorrer na integracao n8n:

1. Parar chamadas n8n para `POST /api/whatsapp/webhook`.
2. Manter `WHATSAPP_ENABLED=false` e `DELIVERY_MOCK_ENABLED=true`.
3. Preservar backend/painel em modo atual de staging com Supabase ativo.
4. Revisar `audit_logs` por `correlationId` e `idempotencyKey`.
5. Retomar testes apenas apos ajuste no fluxo n8n.

## Checklist Pronto para n8n

- [x] Backend staging operacional
- [x] Painel staging operacional
- [x] Supabase real conectado e persistencia validada
- [x] Webhook auth por secret ativo
- [x] Rate limit ativo com auditoria
- [x] Idempotencia ativa com duplicate handling
- [x] Correlation tracing ponta a ponta
- [x] Delivery mock funcional
- [x] Persistencia confirmada apos restart
- [x] Contrato n8n e guia de implementacao documentados

## Conclusao

Staging pronto para integracao n8n real controlada no escopo de webhook + fluxo mock, com pendencias bloqueantes restritas apenas a fases futuras de provider real WhatsApp e delivery real.
