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

## Estudo tecnico oficial (Evolution Foundation)

Referencia obrigatoria: [evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api)

Pontos confirmados no repositorio oficial (main, v2.3.7):

| Item | Valor oficial confirmado |
| --- | --- |
| Imagem Docker recomendada | `evoapicloud/evolution-api:latest` (compose oficial; legado `atendai/evolution-api` nao e o padrao atual) |
| Porta padrao | `8080` (`SERVER_PORT=8080`) |
| Variavel de autenticacao | `AUTHENTICATION_API_KEY` (mapeada no backend como `EVOLUTION_API_KEY`) |
| Header de autenticacao | `apikey` (documentacao oficial; nao usar `Authorization` como padrao Evolution) |
| Health/info | `GET /` (sem auth) retorna `version`, `manager`, `documentation` |
| Fetch instances | `GET /instance/fetchInstances` com header `apikey` |
| Connection state | `GET /instance/connectionState/{instanceName}` com header `apikey` |
| Estados de conexao | `open`, `close`, `connecting` |
| Manager UI | `{SERVER_URL}/manager` quando habilitado |
| Documentacao externa | campo `documentation` em `GET /` (ex.: docs Evolution Foundation) |

Endpoints perigosos (nao chamados pelo backend Doctor Prescreve):

- `GET /instance/connect/{instanceName}` (gera QR)
- `POST /instance/restart/{instanceName}`
- `DELETE /instance/logout/{instanceName}`
- `DELETE /instance/delete/{instanceName}`
- `POST /instance/create`

## Alinhamento do provider backend

Ajustes aplicados em `mdoctor-backend/src/services/providers/evolution.provider.js`:

- Healthcheck em 3 probes seguros:
  - `probeApiInfo` -> `GET /`
  - `probeFetchInstances` -> `GET /instance/fetchInstances`
  - `probeConnectionState` -> `GET /instance/connectionState/{instance}`
- Autenticacao alinhada ao oficial: somente header `apikey`.
- `provider-status` enriquecido com:
  - `configured`, `configuredParts`
  - `apiReachable`, `apiVersion`, `swaggerUrl`, `managerUrl`
  - `instanceName`, `instanceFound`, `instanceState`
  - `connected`, `disconnected`, `connecting`
  - `timeout`, `lastError`, `lastTimeoutAt`
  - `safeReadEndpoints`
- Falha parcial de configuracao nao quebra fluxo; fallback/mock permanece ativo.
- Dry-run/sandbox preservados no delivery.

Validacao local pos-ajuste:

- `npm --prefix mdoctor-backend run check`: OK
- `node --check` nos arquivos alterados: OK
- Staging (antes do redeploy desta alteracao):
  - `/health`, `/readyz`, `/api/whatsapp/test-send`: OK em dry-run
  - `provider-status`: campos novos exigem redeploy do backend staging

## Runtime Evolution API staging conectado

Data/hora: 2026-05-28 12:xx -03:00

### Infraestrutura Railway (Automation-MDoctor / staging)

| Servico | Funcao |
| --- | --- |
| `evolution-api-staging` | API Evolution (`evoapicloud/evolution-api:latest`, porta `8080`) |
| `Postgres` | Banco Evolution |
| `Redis` | Cache Evolution |

URL publica Evolution staging:

```text
https://evolution-api-staging-staging-40d1.up.railway.app
```

Manager UI (QR/pairing manual):

```text
https://evolution-api-staging-staging-40d1.up.railway.app/manager
```

### Instancia WhatsApp staging

- Nome: `mdoctor-staging`
- Integracao: `WHATSAPP-BAILEYS`
- Estado inicial apos create: `connecting` (aguardando QR/pairing de numero de teste)
- Numero: usar **somente linha de teste** (nao numero principal de producao)

### Backend staging configurado

Variaveis aplicadas no `mdoctor-backend-staging` (valores somente no Railway):

- `EVOLUTION_API_URL` -> URL Evolution staging
- `EVOLUTION_API_KEY` -> `AUTHENTICATION_API_KEY` do runtime Evolution
- `EVOLUTION_INSTANCE=mdoctor-staging`
- `WHATSAPP_PROVIDER=evolution`
- `WHATSAPP_SANDBOX_MODE=true`
- `WHATSAPP_DRY_RUN=true` (mantido ate validacao completa)

### Conectar numero (acao manual obrigatoria)

1. Abrir manager: `/manager`
2. Selecionar instancia `mdoctor-staging`
3. Escanear QR ou usar pairing code com WhatsApp de teste
4. Confirmar `GET /instance/connectionState/mdoctor-staging` com `state=open`

Script auxiliar (sem secrets no repo):

```bash
EVOLUTION_API_URL=... EVOLUTION_API_KEY=... EVOLUTION_INSTANCE=mdoctor-staging node mdoctor-backend/scripts/evolution-staging-smoke.js
```

### Teste real controlado (somente apos `open`)

Sequencia recomendada:

1. Validar `provider-status` com `instanceState=open`
2. Desligar temporariamente `WHATSAPP_DRY_RUN=false` (manter `WHATSAPP_SANDBOX_MODE=true`)
3. `POST /api/whatsapp/test-send` para numero autorizado de teste
4. Reativar `WHATSAPP_DRY_RUN=true` ao final

### Producao

Ver: `docs/EVOLUTION-PRODUCTION-READINESS.md` (plano sem ativacao).

## Integracao com Typebot + n8n (dry-run)

Data/hora: 2026-05-28 12:40 -03:00

Fluxo validado:

- Typebot staging-safe -> n8n `typebot-webhook` -> backend webhook -> atendimento Supabase
- `provider-status`: Evolution configurada, `dryRun=true`, instancia `connecting`
- entrega: `provider=dry-run` (sem envio real)
- `test-send`: dry-run quando dentro do intervalo anti-spam

Referencia completa: `docs/E2E-TYPEBOT-N8N-EVOLUTION-STAGING.md`
