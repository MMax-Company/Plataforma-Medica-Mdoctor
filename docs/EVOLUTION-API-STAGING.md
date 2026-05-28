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

## Auditoria Docker / Runtime Railway (2026-05-28)

Escopo: revisao read-only do runtime `evolution-api-staging` (Automation-MDoctor / staging), sem alterar producao, sem recriar banco, sem reconectar QR.

### Arquitetura atual

| Componente | Railway staging | Observacao |
| --- | --- | --- |
| `evolution-api-staging` | `evoapicloud/evolution-api:latest`, porta `8080`, 1 replica | Alinhado ao compose oficial |
| `Postgres` | volume `postgres-volume` (5GB) | Persistencia de metadados/migrations Prisma |
| `Redis` | volume `redis-volume` (AOF em `/data`) | Cache habilitado (`CACHE_REDIS_ENABLED=true`) |
| Volume no container Evolution | **nenhum** (`volumes: []`) | Diverge do compose oficial (`evolution_instances:/evolution/instances`) |

Compose oficial ([evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api)) espera:

- API + Postgres + Redis na mesma rede
- volume nomeado para `/evolution/instances`
- `AUTHENTICATION_API_KEY` no `.env`
- `SERVER_PORT=8080`

Railway staging atende o nucleo (imagem, porta, Postgres, Redis, API key, URL publica), mas **nao monta volume de instancias** no servico da API.

### Envs obrigatorias (validacao)

| Env | Status | Nota |
| --- | --- | --- |
| `SERVER_PORT=8080` | OK | |
| `SERVER_TYPE=http` | OK | |
| `SERVER_URL` | OK | URL publica configurada |
| `DATABASE_PROVIDER=postgresql` | OK | |
| `DATABASE_CONNECTION_URI` | OK | Referencia interna `Postgres` |
| `CACHE_REDIS_ENABLED=true` | OK | |
| `CACHE_REDIS_URI` | OK | Referencia interna `Redis` |
| `AUTHENTICATION_API_KEY` | OK | Somente no Railway (nao commitada) |
| `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true` | OK | |
| `DEL_INSTANCE=false` | OK | Reduz risco de remocao agressiva em memoria |

Envs recomendadas pelo oficial ainda **nao explicitadas** no servico (usam default da imagem):

- `DATABASE_SAVE_DATA_INSTANCE=true` (persistir instancia no banco)
- `DATABASE_SAVE_DATA_NEW_MESSAGE`, `DATABASE_SAVE_DATA_CONTACTS`, etc. (ajustar conforme necessidade de historico)
- `CACHE_REDIS_PREFIX_KEY=evolution`
- `LOG_LEVEL=ERROR,WARN,INFO` (formato com virgulas; valor atual usa espacos)

Nenhuma alteracao foi aplicada nesta auditoria (somente leitura).

### Health / runtime

| Probe | Resultado |
| --- | --- |
| `GET /` | `200`, version `2.3.7`, manager disponivel |
| `GET /instance/fetchInstances` | `200`, instancia `mdoctor-staging` listada |
| `GET /instance/connectionState/mdoctor-staging` | `200`, `state=close` |
| Logs Railway | migrations Prisma OK, `start:prod` sem erro apos boot |
| Replicas | 1 running, 0 crashed |

Backend `provider-status`: `apiReachable=true`, `instanceFound=true`, `instanceState=close`, `dryRun=true`.

### Instancia `mdoctor-staging`

| Campo | Valor |
| --- | --- |
| Integracao | `WHATSAPP-BAILEYS` |
| `fetchInstances.connectionStatus` | `connecting` |
| `connectionState.state` | `close` |
| `ownerJid` | `null` (numero ainda nao pareado) |
| Mensagens/contatos | `_count.Message=0`, `_count.Contact=0` |

Leitura: registro da instancia **persiste no Postgres** (sobrevive redeploy). Sessao WhatsApp **nao esta aberta** porque o QR de teste ainda nao foi concluido — comportamento esperado, nao falha de runtime.

### Persistencia de sessao WhatsApp

| Camada | Staging | Adequado para staging? |
| --- | --- | --- |
| Postgres (Prisma) | Sim — instancia e settings no banco | Sim para metadados |
| Redis (AOF + volume) | Sim | Sim para cache |
| Filesystem `/evolution/instances` | **Nao montado** no servico API | Risco medio apos QR: credenciais Baileys em disco podem ser perdidas em redeploy da API se nao estiverem 100% no banco |

Recomendacao antes de produção: adicionar volume Railway em `evolution-api-staging` montado em `/evolution/instances` (paridade com compose oficial), **sem** recriar banco e **sem** apagar instancia.

### Reconnect / riscos

| Risco | Severidade | Mitigacao |
| --- | --- | --- |
| Redeploy da API sem volume de instancias | Media | Volume em `/evolution/instances` ou confirmar persistencia Baileys so no Postgres |
| Estado `connecting` (DB) vs `close` (runtime) | Baixa | Normal antes do QR; usar `connectionState` como fonte operacional |
| Baileys / versao web WhatsApp | Media | Monitorar releases Evolution; nao depender para producao final |
| Escala horizontal (2+ replicas API) | Alta se aplicada | **Nao escalar** Evolution Baileys sem store compartilhado; manter 1 replica |
| `DEL_INSTANCE=false` | Positivo | Mantem instancia registrada |
| Fila/worker extra | Nao necessario agora | API unica suficiente para envio pontual Doctor Prescreve |

Reconnect automatico de QR: **nao executado** nesta auditoria (conforme escopo).

### Fila / worker extra

Para o escopo Doctor Prescreve (envio de receita pontual, dry-run, sandbox): **nao e necessario** worker/fila adicional. RabbitMQ/SQS do Evolution permanecem desligados (padrao oficial).

### Conclusao da auditoria

- Arquitetura staging: **adequada para testes** com ressalva do volume de instancias.
- Railway vs documentacao oficial: **parcialmente alinhado** (falta volume na API).
- Seguro para continuar dry-run + integracao Typebot/n8n/backend: **sim**.
- Pronto para producao: **nao** — ver `docs/EVOLUTION-PRODUCTION-READINESS.md`.

## Auditoria de imagem Docker (2026-05-28)

### Imagem local

| Repositorio | Tag | Digest | Status |
| --- | --- | --- | --- |
| `evoapicloud/evolution-api` | `latest` | `sha256:966625532d9076a2381e973a271307d107e6f070450de3abeeea8bd18be07252` | Oficial, OK |
| `atendai/evolution-api` | — | — | **Nao encontrada** localmente |

Nenhuma imagem legada local para remover. Se no futuro existir `atendai/evolution-api` por engano:

```bash
# somente apos autorizacao explicita
docker image ls atendai/evolution-api
docker image rm atendai/evolution-api:<tag>
```

### Imagem Railway (`evolution-api-staging`)

| Campo | Valor |
| --- | --- |
| Servico | `evolution-api-staging` |
| Imagem configurada | `evoapicloud/evolution-api:latest` |
| Correcao necessaria | **nao** (ja oficial) |
| Deploy status | `SUCCESS`, 1 replica running |
| Volume `/evolution/instances` | **ausente** (recomendacao pendente; nao alterado) |

Nenhum redeploy foi necessario nesta rodada (imagem ja correta).

### Validacao pos-auditoria

| Endpoint | Resultado |
| --- | --- |
| `GET /` | `200`, version `2.3.7` |
| `/manager` | `301` (redirect esperado) |
| `fetchInstances` | `200`, instancia `mdoctor-staging` presente |
| `connectionState/mdoctor-staging` | `200`, `state=close` (QR pendente) |
| Backend `provider-status` | `configured=true`, `instanceFound=true`, `apiVersion=2.3.7` |

Instancia `mdoctor-staging` preservada. Postgres e Redis nao foram alterados.

## Plano: volume `/evolution/instances` (preparado, nao aplicado)

Data/hora: 2026-05-28 — analise e runbook apenas. **Nenhuma alteracao foi executada no Railway.**

### Referencia oficial

- Compose: [evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api) — `evolution_instances:/evolution/instances`
- Template Railway Evolution: volume obrigatorio em `/evolution/instances` para arquivos de autenticacao WhatsApp; metadados no Postgres
- Baileys: credenciais multi-arquivo (`useMultiFileAuthState`) gravadas em disco; evento `creds.update` persiste sessao; reconnect apos restart depende desses arquivos + estado no banco

### O que cada camada persiste hoje (staging)

| Camada | Montado / ativo | Conteudo tipico | Sobrevive redeploy API? |
| --- | --- | --- | --- |
| Postgres (`postgres-volume`) | Sim | Instancia `mdoctor-staging`, settings Prisma, historico se flags ativas | Sim |
| Redis (`redis-volume`, AOF) | Sim | Cache Baileys / filas leves | Sim |
| `/evolution/instances` no container API | **Nao** | `creds`, keys, store Baileys por instancia | **Nao** (ephemeral do container) |

Estado atual da instancia: `connectionState=close`, QR **ainda nao concluido**. Registro no Postgres existe; **ainda nao ha sessao WhatsApp pareada** em disco.

### Risco atual (sem volume)

| Cenario | Impacto |
| --- | --- |
| Redeploy / restart do servico `evolution-api-staging` | Metadados da instancia permanecem no Postgres; **arquivos de auth Baileys no filesystem do container sao perdidos** |
| Apos escanear QR (`connectionState=open`) e depois redeploy | **Alto**: provavel necessidade de **novo QR** ou reconnect falho ate re-parear |
| Deploy de nova imagem `latest` | Mesmo risco de restart |
| Escala para 2+ replicas | **Proibido** com Baileys (Railway: 1 volume = 1 replica; Evolution: sessao local) |

Com `WHATSAPP_DRY_RUN=true` o backend nao envia mensagens reais, mas **a sessao Evolution ainda seria afetada** em testes pos-QR.

### Necessidade real do volume

| Pergunta | Resposta |
| --- | --- |
| Obrigatorio para criar instancia? | Nao — `mdoctor-staging` ja existe via API/Postgres |
| Obrigatorio para dry-run backend? | Nao — backend nao depende do filesystem Evolution |
| Obrigatorio antes de producao / QR real? | **Sim** — alinhamento com compose oficial e template Railway |
| Substitui Postgres? | **Nao** — complementa (DB + disco) |

### Railway: suporta sem destruir o servico?

| Pergunta | Resposta |
| --- | --- |
| Recriar servico `evolution-api-staging`? | **Nao necessario** |
| Apagar Postgres/Redis? | **Nao** |
| Apagar instancia `mdoctor-staging`? | **Nao** |
| Adicionar volume ao servico existente? | **Sim** — `railway volume add` ou UI (Settings → Volumes) |
| Redeploy necessario? | **Sim** — volume monta no **start** do container; breve downtime (~segundos a ~1 min) |
| Limite Railway | 1 volume por servico (API ainda tem 0); replicas incompatíveis com volume |
| Permissões Docker | Se API falhar ao escrever no volume, considerar `RAILWAY_RUN_UID=0` (doc Railway) |

### Precisa novo QR?

| Momento da operacao | Novo QR? |
| --- | --- |
| **Agora** (antes do primeiro QR, estado atual) | **Nao** — volume nasce vazio; apos mount, escanear QR **uma vez** com persistencia correta |
| Depois de `connectionState=open` sem volume | **Provavelmente sim** apos primeiro redeploy sem creds em disco |
| Depois de `open` + volume ja montado | **Nao** (esperado) — auth em `/evolution/instances` + Postgres |

Resumo para staging atual: **nao precisa refazer QR que nunca foi feito**; o volume deve ser aplicado **antes** do primeiro pareamento.

### Procedimento seguro (executar somente apos confirmacao explicita)

**Pre-requisitos**

1. Confirmar dry-run ativo no backend (`WHATSAPP_DRY_RUN=true`).
2. Nao chamar `connect` / `restart` / `logout` / `delete` na instancia.
3. Registrar baseline (local, sem expor secrets):

```bash
# substituir URL e usar apikey do Railway localmente
curl -sS -H "apikey: $EVOLUTION_API_KEY" \
  "https://evolution-api-staging-staging-40d1.up.railway.app/instance/fetchInstances"
curl -sS -H "apikey: $EVOLUTION_API_KEY" \
  "https://evolution-api-staging-staging-40d1.up.railway.app/instance/connectionState/mdoctor-staging"
```

**Passo A — criar e montar volume (somente servico Evolution API)**

No projeto **Automation-MDoctor**, ambiente **staging**, servico **`evolution-api-staging`**:

- Mount path exato: `/evolution/instances`
- Tamanho sugerido: **5 GB** (plano Hobby; mesmo padrao Postgres/Redis staging)
- Nome sugerido: `evolution-instances-volume`

Via CLI (com contexto linkado ao projeto/ambiente/servico):

```bash
# NAO EXECUTADO — runbook
railway link --project fe962e4e-4c41-4c94-9d2d-dbdfe37d0ed4 \
  --environment 6c77be19-3b24-46a2-9fc2-4511b920f5aa \
  --service ab310799-fef4-4f28-8ecf-bdd2c0fa0aaf

railway volume add --mount-path /evolution/instances
# Railway injeta RAILWAY_VOLUME_MOUNT_PATH em runtime; nao definir manualmente
```

Via UI: Service → **Volumes** → Add Volume → mount `/evolution/instances`.

**Passo B — redeploy controlado**

- Redeploy **apenas** `evolution-api-staging` (nao Postgres, nao Redis, nao backend).
- Aguardar `SUCCESS` e 1 replica running.

**Passo C — validacao pos-mudanca**

| Check | Esperado |
| --- | --- |
| `GET /` | `200`, version `2.3.7` |
| `fetchInstances` | `mdoctor-staging` ainda listada |
| `connectionState` | `close` (ate QR) |
| `provider-status` backend | `instanceFound=true`, `dryRun=true` |
| Railway service JSON | `volumes: [{ mountPath: "/evolution/instances", ... }]` |

**Passo D — QR (quando autorizado, fora deste plano)**

- Abrir `/manager`, conectar `mdoctor-staging`, escanear QR.
- Confirmar `connectionState=open` e que **um segundo redeploy** mantem `open` sem novo QR.

**Envs opcionais (revisar na mesma janela, sem secrets no repo)**

- `DATABASE_SAVE_DATA_INSTANCE=true` (explicitar no Railway; padrao da imagem pode ja salvar)
- Manter `DEL_INSTANCE=false`
- Nao alterar `DATABASE_CONNECTION_URI` nem URLs de Postgres/Redis

### Rollback (se algo falhar)

1. **Nao** apagar Postgres/Redis nem deletar instancia.
2. Se API nao subir: logs Railway; testar `RAILWAY_RUN_UID=0` se erro de permissao em `/evolution/instances`.
3. Desfazer volume: `railway volume detach` + redeploy — **perde** arquivos gravados no volume; instancia no Postgres permanece.
4. Backend: manter `WHATSAPP_DRY_RUN=true`.

### Status deste plano

| Item | Status |
| --- | --- |
| Analise documentada | Feito |
| Volume aplicado no Railway | **Pendente — aguardando sua confirmacao** |
| Producao | Intocada |
