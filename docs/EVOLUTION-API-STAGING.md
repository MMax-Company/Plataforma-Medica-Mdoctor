# Evolution API Staging Preparation

Data/hora: 2026-05-28 11:xx -03:00

## Objetivo

Preparar arquitetura de provider WhatsApp para staging com suporte a Evolution API, preservando fallback/mock atual e sem qualquer impacto em produção.

## Arquitetura provider-based

Selecao de provider por env:

- `WHATSAPP_PROVIDER=mock|evolution`
- default seguro: `mock`

Componentes:

- Mock provider (comportamento atual preservado em `delivery.service`)
- Evolution provider (`mdoctor-backend/src/services/providers/evolution.provider.js`)
- Selector de provider no delivery (`mdoctor-backend/src/delivery/delivery.service.js`)

## Provider Evolution API

Servico implementado:

- `sendTextMessage`
- `sendDocumentMessage`
- `healthCheck`
- `normalizeResponse`

Comportamento:

- So tenta envio real quando `WHATSAPP_PROVIDER=evolution` e envs de Evolution estao configuradas.
- Em falha de Evolution:
  - se mock permitido (`DELIVERY_MOCK_ENABLED=true` em staging), aplica fallback controlado
  - logs/retorno mantem rastreabilidade de provider
  - sem quebra de fluxo clinico

## Endpoint de status do provider

Novo endpoint:

- `GET /api/whatsapp/provider-status`

Retorna:

- provider atual
- modo (`mock|real`)
- status de mock habilitado
- health/config da Evolution (quando aplicavel)
- estado de sandbox/dry-run
- anti-spam ativo e telemetria de janela
- runtime (`lastError`, `lastTimeoutAt`, `connected/disconnected`)

## Sandbox mode e dry-run

Novas protecoes:

- `WHATSAPP_SANDBOX_MODE=true`
  - bloqueia envio Evolution automatico no fluxo operacional
  - exige chamada manual explicita para testes (`/api/whatsapp/test-send`)
  - bloqueia tentativa de bulk no endpoint de teste
- `WHATSAPP_DRY_RUN=true`
  - simula envio
  - nao envia para provider real
  - retorna payload simulado com warning e provider `dry-run`

## Anti-spam no sandbox

Controles adicionados:

- limite global por janela:
  - `WHATSAPP_SANDBOX_RATE_LIMIT_MAX`
  - `WHATSAPP_SANDBOX_RATE_LIMIT_WINDOW_MS`
- intervalo minimo por numero:
  - `WHATSAPP_SANDBOX_MIN_INTERVAL_MS`
- erros de protecao:
  - `SANDBOX_RATE_LIMIT`
  - `SANDBOX_MIN_INTERVAL`

## Variaveis de ambiente (sem secrets)

Adicionadas em `.env.example` e `.env.staging.example`:

- `WHATSAPP_PROVIDER=mock`
- `WHATSAPP_SANDBOX_MODE`
- `WHATSAPP_DRY_RUN`
- `WHATSAPP_SANDBOX_RATE_LIMIT_MAX`
- `WHATSAPP_SANDBOX_RATE_LIMIT_WINDOW_MS`
- `WHATSAPP_SANDBOX_MIN_INTERVAL_MS`
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE`
- `EVOLUTION_TIMEOUT_MS`

Nenhum valor sensivel real foi commitado.

## Preservacao de fluxo e seguranca

Mantido:

- fallback/mock como padrao
- correlationId
- idempotencia do webhook
- audit logs e tracking de entrega
- persistencia em Supabase
- contratos publicos existentes

Nao alterado:

- producao
- Stripe
- Memed producao
- n8n/Typebot structure principal

## Riscos e observacoes

- Evolution API pode variar por versao; `healthCheck` e `normalizeResponse` tratam respostas heterogeneas.
- Ativacao real do provider deve ocorrer apenas apos smoke test controlado em staging.

## Proximos passos para ativacao controlada

1. Definir credenciais Evolution apenas no backend staging.
2. Ajustar:
   - `WHATSAPP_PROVIDER=evolution`
   - `EVOLUTION_API_URL`
   - `EVOLUTION_API_KEY`
   - `EVOLUTION_INSTANCE`
3. Validar `GET /api/whatsapp/provider-status`.
4. Testar envio ficticio em staging.
5. Confirmar fallback mock em caso de falha.

## Endpoint seguro de teste manual

Novo endpoint:

- `POST /api/whatsapp/test-send`

Protecoes:

- auth obrigatoria (`Bearer`)
- fora de producao
- exige `WHATSAPP_SANDBOX_MODE=true`
- bloqueia envio em massa/bulk
- registra `audit_logs` em sucesso/falha

## Ativacao dry-run em staging (backend)

Data/hora: 2026-05-28 11:46 -03:00

Escopo aplicado:

- Somente servico `mdoctor-backend-staging` no Railway.
- Nenhuma alteracao em producao.
- Nenhuma configuracao de `EVOLUTION_API_KEY` real.

Variaveis ativas no backend staging:

- `WHATSAPP_PROVIDER=evolution`
- `WHATSAPP_SANDBOX_MODE=true`
- `WHATSAPP_DRY_RUN=true`

Deploy:

- Redeploy executado apenas do backend staging (`mdoctor-backend-staging`), sem alterar painel/n8n/producao.

Validacoes funcionais:

- `GET /health`: `200` (servico ativo).
- `GET /readyz`: `200` (staging operacional, com warnings esperados de ambiente nao-final).
- `GET /api/whatsapp/provider-status`: `200` com:
  - `provider=evolution`
  - `sandboxMode=true`
  - `dryRun=true`
  - `fallbackActive=true`
  - `mode=mock`
- `POST /api/whatsapp/test-send` autenticado: `200` com:
  - `delivery.provider=dry-run`
  - `delivery.providerStatus=simulated`
  - `warning=WHATSAPP_DRY_RUN ativo: envio apenas simulado`

Conclusao da rodada:

- Dry-run/sandbox ativo em staging: sim.
- Envio real de mensagem: nao.
- Fallback seguro preservado: sim.
