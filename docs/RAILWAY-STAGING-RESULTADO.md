# Railway Staging Execution Result - Doctor Prescreve

Data/hora: 2026-05-28 03:00:15 -03:00

## Escopo

Repositorio:

```text
C:\Users\drmax\OneDrive\Área de Trabalho\Mdoctor-Survive
```

Branch:

```text
codex/legacy-compat-infra
```

Objetivo: tentar avancar o Railway staging de forma controlada ou bloquear a execucao quando nao houver certeza absoluta de que os comandos afetariam apenas staging.

## Railway CLI status

- Railway CLI: `railway 4.58.0`
- Login Railway: OK
- Usuario logado: `Doctor Markenting`
- Email logado: `marketing.cvl.ia@gmail.com`
- Workspace: `Doctor Markenting's Projects`

## Projeto e ambiente detectados

Comando de leitura executado:

```bash
railway status --json
```

Resultado relevante:

- Projeto atual linkado: `Backend-Mdoctor`
- Projeto ID: `bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b`
- Ambientes no projeto atual:
  - `staging`
  - `production`
- Servico staging detectado:
  - nome: `mdoctor-backend-staging`
  - service ID: `53960eb4-a1be-4d7c-b665-462049e52085`
  - URL: `https://mdoctor-backend-staging-staging.up.railway.app`
  - status: `SUCCESS`
  - instancia: `RUNNING`
- Servico production detectado no mesmo projeto:
  - nome: `web`
  - source repo: `MMax-Company/Mdoctor-Prescreve`
  - URL: `https://web-production-5f178.up.railway.app`
  - status: `SUCCESS`

Comando de leitura executado:

```bash
railway project list --json
```

Projetos relevantes detectados:

- `Backend-Mdoctor`
  - ambientes: `staging`, `production`
  - servicos: `mdoctor-backend-staging`, `web`
- `Painel-MDoctor`
  - ambientes: `production`, `staging`
  - servicos: `painel-medico-staging`, `Painel Medico`
- `Automation-MDoctor`
  - ambiente: `production`
  - servicos: `n8n Node`, `mdoctor-automation`, `Postgres Node`

Comando de leitura executado:

```bash
railway service list --json
```

Resultado no contexto atual:

- Somente `mdoctor-backend-staging` apareceu como servico linkado no contexto atual.

## IDs Railway identificados

| Projeto | Environment | Service | ID | Funcao | Risco | Observacao |
| --- | --- | --- | --- | --- | --- | --- |
| Workspace `Doctor Markenting's Projects` | N/A | N/A | `e4d69025-145a-4901-98b2-35af61de2fe8` | Workspace Railway autenticado | Baixo | Usuario logado: `Doctor Markenting` / `marketing.cvl.ia@gmail.com`. |
| `Backend-Mdoctor` | N/A | N/A | `bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b` | Projeto backend atual linkado | Alto | Contem `staging` e `production`; nao executar mutacoes sem `environmentId` explicito. |
| `Backend-Mdoctor` | `staging` | N/A | `d297af6e-c5e2-406a-9798-69a02f0e7394` | Ambiente staging do backend | Medio | Ambiente correto para backend staging, mas fica no mesmo projeto que production. |
| `Backend-Mdoctor` | `production` | N/A | `f2f1c163-1dee-4bb0-9a3b-5dce942fa3ba` | Ambiente production do backend legado | Alto | Nao tocar; contem servico `web` apontando para `MMax-Company/Mdoctor-Prescreve`. |
| `Backend-Mdoctor` | `staging` | `mdoctor-backend-staging` | `53960eb4-a1be-4d7c-b665-462049e52085` | Service ID do backend staging | Medio | URL: `https://mdoctor-backend-staging-staging.up.railway.app`; status `SUCCESS`, instancia `RUNNING`. |
| `Backend-Mdoctor` | `staging` | service instance de `mdoctor-backend-staging` | `cdad08d4-fd3b-44ee-b004-326426bc8641` | Instancia do servico no ambiente staging | Medio | Nao usar como service ID em comandos CLI; service ID principal e `53960eb4-a1be-4d7c-b665-462049e52085`. |
| `Backend-Mdoctor` | `staging` | deployment de `mdoctor-backend-staging` | `135828ed-ddcd-4e02-882c-89888e899209` | Deployment atual backend staging | Baixo | Deployment `SUCCESS`, criado em `2026-05-27T03:09:25.519Z`. |
| `Backend-Mdoctor` | `production` | `web` | `f5569fee-b396-4df8-bdba-044377cc269b` | Service ID do backend production legado | Critico | Nao tocar; source repo `MMax-Company/Mdoctor-Prescreve`, URL `https://web-production-5f178.up.railway.app`. |
| `Backend-Mdoctor` | `production` | service instance de `web` | `49ecb4a6-7320-40aa-bbec-27ad5ce34d5d` | Instancia production do servico `web` | Critico | Nao usar em comandos de staging. |
| `Backend-Mdoctor` | `production` | deployment de `web` | `77783bd2-cb4e-4170-8c39-7300ab72baac` | Deployment production atual | Critico | Nao tocar. |
| `Painel-MDoctor` | N/A | N/A | `3bec26a7-422e-40ae-8763-2a4c5158fef4` | Projeto do painel | Medio | Projeto separado do backend; confirmar antes de operar. |
| `Painel-MDoctor` | `staging` | N/A | `faae345a-79ee-46e9-abf6-d2dedd08a538` | Environment ID staging do painel | Medio | Ambiente candidato para painel staging. |
| `Painel-MDoctor` | `production` | N/A | `ca02b8b9-7c4d-4471-bcb3-ffbd9a8d6602` | Environment ID production do painel | Alto | Nao tocar. |
| `Painel-MDoctor` | `staging` | `painel-medico-staging` | `626fc9d2-3f6a-417c-b3a7-e3e21846edb8` | Service ID do painel staging | Medio | Nome difere do planejado `Painel-MDoctor-Staging`; confirmar se este e o alvo correto. |
| `Painel-MDoctor` | `production` | `Painel Medico` | `e9bca6ab-63a4-4ee7-90c3-9dab7f081e6e` | Service ID do painel production | Alto | Nao tocar. |
| `Memory-Mdoctor` | `production` | `Redis` | `16b6a346-feb0-4a46-a108-d61c3a4ffae4` | Redis/memoria em outro projeto | Alto | Fora do escopo staging Doctor Prescreve. |
| `Automation-MDoctor` | `production` | `n8n Node` | `07ab35a6-b8d5-4cdc-85ea-2579468ca355` | Automacao/n8n production | Critico | Nao tocar nesta fase. |
| `Automation-MDoctor` | `production` | `mdoctor-automation` | `8b8a37ef-dd5b-432e-b642-f0d770f9478a` | Automacao production | Critico | Nao tocar nesta fase. |
| `Automation-MDoctor` | `production` | `Postgres Node` | `e6e2059b-1f3c-4af1-9846-b5d41185d085` | Banco production/automacao | Critico | Nao tocar nesta fase. |

IDs nao identificados:

- Deployment/URL do `painel-medico-staging`: nao identificado pelo contexto atual, porque `railway service list --json` retornou apenas o servico linkado `mdoctor-backend-staging`. Para obter detalhes do painel sem risco, confirmar manualmente o projeto `Painel-MDoctor` e consultar com contexto/IDs explicitos.
- Service instance ID do `painel-medico-staging`: nao identificado pelo mesmo motivo.

## Staging executado ou bloqueado

Status: bloqueado.

Motivo:

- O contexto Railway atual esta linkado ao projeto `Backend-Mdoctor`, que contem os ambientes `staging` e `production`.
- O mesmo projeto contem um servico de producao `web` apontando para o repositorio legado `MMax-Company/Mdoctor-Prescreve`.
- Existe um servico staging de backend ja rodando, mas o nome detectado e `mdoctor-backend-staging`, nao exatamente `Backend-MDoctor-Staging`.
- O painel staging existe em outro projeto Railway (`Painel-MDoctor`), nao no mesmo contexto linkado.
- Sem confirmacao manual explicita do projeto, ambiente e servico alvo por ID, executar `railway add`, `railway variable set` ou `railway up` poderia afetar contexto errado.

Decisao:

- Nenhum servico foi criado.
- Nenhuma env foi configurada.
- Nenhum deploy foi executado.
- Producao permaneceu intocada.

## Comandos executados

Somente leitura/local:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
railway --version
railway whoami --json
railway status --json
railway project list --json
railway service list --json
```

## Comandos NAO executados

Bloqueados por seguranca:

```bash
railway link
railway add --service Backend-MDoctor-Staging
railway add --service Painel-MDoctor-Staging
railway variable set ...
railway up --detach ...
```

## Proximos passos manuais

1. Abrir Railway e confirmar manualmente o projeto correto.
2. Confirmar se o staging deve usar o projeto `Backend-Mdoctor` ou criar projeto/servicos separados.
3. Confirmar IDs exatos antes de qualquer mutacao:
   - project ID
   - environment ID de `staging`
   - service ID do backend staging
   - service ID do painel staging
4. Se for usar backend existente, confirmar se `mdoctor-backend-staging` deve substituir o nome planejado `Backend-MDoctor-Staging`.
5. Se for usar painel existente, confirmar se `painel-medico-staging` deve substituir o nome planejado `Painel-MDoctor-Staging`.
6. Depois da confirmacao manual, executar comandos com IDs/servicos explicitos, nunca por contexto ambiguo.

## Confirmacoes do bloqueio inicial

- Producao nao foi alterada.
- Railway nao recebeu deploy.
- Railway nao recebeu novas variaveis.
- Nenhum dominio oficial foi alterado.
- Memed real nao foi ativada.
- WhatsApp real nao foi ativado.
- Stripe/pagamentos nao foram ativados.
- Codigo funcional nao foi alterado.

## Backend staging deployment real

Data/hora: 2026-05-28 03:26:23 -03:00

Escopo autorizado:

- Projeto: `Backend-Mdoctor`
- Project ID: `bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b`
- Environment staging ID: `d297af6e-c5e2-406a-9798-69a02f0e7394`
- Service staging: `mdoctor-backend-staging`
- Service ID: `53960eb4-a1be-4d7c-b665-462049e52085`

Variaveis staging configuradas, sem revelar secrets:

- `NODE_ENV=staging`
- `PORT=3004`
- `MEMED_ENV=mock`
- `JWT_SECRET` gerado forte e configurado somente no backend staging
- `MEDICO_USER` configurado para login staging
- `MEDICO_PASS` gerada forte e configurada somente no backend staging
- `MEDICO_ROLE=admin`

Deploys executados:

- `ee90dd65-14a7-4a9c-ad31-ac9d7d12211d`: deploy inicial backend staging, `SUCCESS`
- `b59c8906-ea70-4515-95a8-df02fb41ae90`: deploy backend staging com env de auth staging, `SUCCESS`

URL backend staging:

```text
https://mdoctor-backend-staging-staging.up.railway.app
```

Endpoints validados:

| Endpoint | Resultado | Observacao |
| --- | --- | --- |
| `GET /health` | OK | Retornou `status: OK`. |
| `GET /readyz` | OK com warning | `storage.mode=fallback_local`, `memed.source=mock`; esperado sem Supabase/Memed reais. |
| `POST /api/auth/login` | OK | Login staging validado com credenciais configuradas no Railway; token nao registrado. |
| `GET /api/atendimentos` | OK | Validado com Bearer token staging. |

Logs importantes:

```text
Starting Container
> mdoctor-backend@1.0.0 start
> node server.js
Supabase nao configurado. Backend em modo desenvolvimento.
production_readiness_incomplete
whatsapp_disabled
server_started
```

Leitura dos logs:

- Container iniciou corretamente.
- Supabase nao configurado gera warning esperado no staging mock.
- WhatsApp permaneceu desativado.
- Servidor iniciou.
- Requisicoes HTTP de validacao chegaram ao servico.

Confirmacoes apos deploy:

- Producao nao foi alterada.
- Environment `production` nao foi usado.
- Service production `web` nao foi usado.
- Repositorio legado `Mdoctor-Prescreve` nao foi usado.
- Dominio oficial nao foi alterado.
- Memed real nao foi ativada.
- WhatsApp real nao foi ativado.
- Stripe/pagamentos nao foram ativados.
- Codigo funcional nao foi alterado.

Proximos passos:

1. Usar a URL do backend staging no painel staging via `NEXT_PUBLIC_API_URL`.
2. Confirmar manualmente o alvo do painel staging antes de qualquer deploy do painel.
3. Validar `/login`, `/dashboard` e fluxo mock no painel.
4. Manter Supabase/Memed/WhatsApp reais fora ate o staging base estar validado.

## Supabase staging real - tentativa de ativacao

Data/hora: 2026-05-28 05:22 -03:00

Escopo autorizado:

- Somente backend staging `mdoctor-backend-staging`.
- Nenhuma alteracao em producao.
- Nenhum segredo salvo em codigo ou documentacao.

Configuracao aplicada no Railway backend staging:

- `SUPABASE_URL` configurada.
- `SUPABASE_ANON_KEY` configurada.
- `SUPABASE_SERVICE_ROLE_KEY` configurada somente no backend.
- `SUPABASE_BUCKET_PRESCRIPTIONS=receitas`.

Validacao imediata apos configuracao:

- `GET /readyz` retornou `storage.mode=supabase`, `supabase.connected=true`, `fallback_local=false`.

Validacao apos redeploy do backend staging:

- `GET /readyz` retornou `storage.mode=fallback_local`, `supabase.connected=false`.
- Erro reportado: `Could not find the table 'public.audit_logs' in the schema cache`.

Leitura tecnica:

- O backend esta preparado para persistencia real com fallback seguro.
- A migration do repositorio (`20260527_backend_mvp_storage.sql`) cria `patients`, `atendimentos`, `prescriptions`, `audit_logs`, RLS/policies e buckets.
- O projeto Supabase staging alvo ainda nao reflete integralmente esse schema no Data API, impedindo manter `storage.mode=supabase` de forma estavel.

Status da ativacao:

- Parcial: conectou com Supabase, mas regrediu para fallback por inconsistencia de schema (`audit_logs` ausente no cache da API).
- Painel staging permaneceu operacional (`/login` e `/dashboard` 200).
- Produção permaneceu intocada.

## Supabase staging real - estabilizacao de schema

Data/hora: 2026-05-28 05:43 -03:00

Objetivo:

- Estabilizar `storage.mode=supabase` e `supabase.connected=true` sem tocar producao.

Diagnostico de schema no Supabase staging:

- A API OpenAPI do schema `public` foi inspecionada com service role.
- `public.audit_logs` nao aparece no schema exposto.
- O backend continua registrando erro em `/readyz`:
  - `Could not find the table 'public.audit_logs' in the schema cache`
- Tabelas legadas expostas incluem `atendimentos`, `patients`, `prescriptions`, `decisoes_log`, `entregas_receita`, entre outras.

Acoes aplicadas no Supabase staging:

- Validacao de buckets executada.
- Buckets faltantes criados:
  - `documents`
  - `prescriptions`
  - `receitas`
  - `medical-records`
  - `consents`
  - `logs`

Estado dos endpoints apos redeploy do backend staging:

- `GET /health`: OK
- `GET /readyz`: `storage.mode=fallback_local`, `supabase.connected=false`
- `GET /api/atendimentos`: OK
- `GET /api/prescriptions/:id`: OK

Estado do painel staging:

- `/login`: 200
- `/dashboard`: 200
- Fluxo mock permaneceu operacional.

Conclusao tecnica:

- A estabilizacao final depende de ajuste de schema no projeto Supabase staging para disponibilizar `public.audit_logs` (ou aplicar a migration SQL completa nesse projeto).
- Sem esse ajuste de schema, o backend permanece corretamente em fallback seguro.

## Validacao final apos SQL compativel aplicado

Data/hora: 2026-05-28 06:12 -03:00

Resultado da verificacao:

- `public.audit_logs` ficou acessivel via PostgREST com service role.
- Buckets staging conferidos:
  - `documents`
  - `prescriptions`
  - `receitas`
  - `medical-records`
  - `consents`
  - `logs`

Bloqueio remanescente para estabilizacao:

- O backend volta para fallback quando tenta criar atendimento no Supabase:
  - erro: `new row for relation "atendimentos" violates check constraint "atendimentos_status_check"`
- Esse constraint pertence ao schema legado atual de `atendimentos` e rejeita status canonicos usados pelo backend (`waiting`, `em_atendimento`, etc.).
- Enquanto esse check constraint nao for ajustado para os status atuais, `storage.mode` nao permanece estavel em `supabase`.

Estado no encerramento da validacao:

- `GET /health`: OK
- `GET /readyz`: `storage.mode=fallback_local`, `supabase.connected=false`
- `GET /api/atendimentos`: OK (com fallback)
- `GET /api/prescriptions/:id`: OK (mock)
- Painel staging permaneceu operacional (`/login` e `/dashboard` com 200).

Observacao:

- Nenhuma alteracao em producao.
- Nenhum segredo foi salvo em codigo ou documentacao.

## Validacao final - storage Supabase estabilizado

Data/hora: 2026-05-28 06:20 -03:00

Escopo executado:

- Redeploy somente do backend staging `mdoctor-backend-staging`.
- Validacoes de saude, persistencia e painel sem alterar producao.

Resultados apos correcao do constraint `atendimentos_status_check`:

- `GET /health`: OK
- `GET /readyz`: `storage.mode=supabase`, `supabase.connected=true`, `error=null`
- `GET /api/atendimentos`: OK
- `GET /api/prescriptions/:id`: OK (source mock)

Persistencia apos restart/redeploy:

- Atendimento de validacao `038d3205-2ee2-4ef8-b97e-802fcb0e2ac2` permaneceu acessivel apos novo redeploy.
- Status persistido manteve `ready`.
- Contagem de atendimentos permaneceu consistente.

Painel staging:

- `/login`: 200
- `/dashboard`: 200
- Fluxo mock basico permaneceu funcional.

Conclusao:

- Storage Supabase staging estabilizado no backend.
- Fallback local permanece disponivel como mecanismo de seguranca, mas nao esta ativo no estado final.
- Producao permaneceu intocada.

## Memed - restricao de credenciais

Data/hora: 2026-05-28 06:28 -03:00

Decisao operacional:

- Memed sandbox indisponivel para este projeto.
- Credenciais Memed disponiveis sao de producao.
- Nao configurar credenciais de producao no backend staging sem autorizacao explicita.
- Manter Memed em modo mock no staging ate aprovacao formal.

Risco documentado:

- Ativar credenciais de producao em staging pode disparar integracao real em ambiente nao produtivo.
- Risco de emissao indevida de receita/artefatos fora do fluxo controlado.

Validacao do estado atual (sem configurar secrets Memed):

- Backend staging: OK.
- Painel staging: OK.
- Supabase staging: OK (`storage.mode=supabase`, `supabase.connected=true`).
- Memed mock preservado (`memed.source=mock`, `POST /api/prescriptions/:id/generate` retornando `source=mock`).

Confirmacoes:

- Nenhuma credencial Memed de producao configurada no Railway staging nesta etapa.
- Nenhum segredo salvo em codigo ou documentacao.
- Producao permaneceu intocada.

## WhatsApp/n8n staging - preparo sem pagamentos

Data/hora: 2026-05-28 06:31 -03:00

Escopo:

- Validar trilha WhatsApp/n8n em staging sem tocar Stripe/pagamentos.
- Manter entrega em modo mock/controlado.

Validacoes executadas:

- `GET /api/whatsapp/status`: OK (`enabled=false`, modo desenvolvimento/staging).
- `POST /api/whatsapp/webhook`: OK, criando atendimento em fila (`waiting`).
- `PATCH /api/atendimentos/:id/status`: OK.
- `POST /api/prescriptions/:id/generate`: OK (`source=mock`).
- `POST /api/atendimentos/:id/deliver` com `channel=whatsapp`: OK (`provider=mock`, status `delivered`).
- Persistencia no Supabase:
  - `audit_logs` com registros relacionados ao atendimento.
  - `entregas_receita` com entrega registrada.
- Painel staging preservado:
  - `/login`: 200
  - `/dashboard`: 200

Separacao confirmada:

- WhatsApp/n8n validado em trilha independente.
- Stripe/pagamentos nao ativados e nao alterados.

Conclusao:

- WhatsApp staging mock/controlado pronto para uso tecnico.
- Para n8n real ainda faltam hardening de autenticacao de webhook, idempotencia e observabilidade.
- Producao permaneceu intocada.

## WhatsApp webhook - seguranca minima n8n

Data/hora: 2026-05-28 06:39 -03:00

Implementacao:

- Adicionado controle de segredo por header no endpoint `POST /api/whatsapp/webhook`.
- Header exigido: `X-MDoctor-Webhook-Secret`.
- Variavel de ambiente backend: `N8N_WEBHOOK_SECRET`.
- Quando `N8N_WEBHOOK_SECRET` estiver configurado, chamadas sem header correto retornam `401`.
- Sem secret configurado em dev/local, webhook continua permitido com warning controlado.
- Valor do secret nao e exposto em logs.

Validacao staging:

- Com secret configurado no backend staging:
  - Sem header: `401`.
  - Com header correto: `200`.
- Atendimento criado com sucesso e persistido.
- Auditoria registrada no Supabase:
  - `webhook_unauthorized`
  - `webhook_processed`

Confirmacoes:

- Sem alteracao de Stripe/pagamentos.
- Sem alteracao de producao.
- Sem commit de secrets.

## WhatsApp webhook - rate limit minimo

Data/hora: 2026-05-28 06:50 -03:00

Implementacao:

- Rate limit dedicado aplicado em `POST /api/whatsapp/webhook`.
- Controle por IP com janela curta.
- Resposta `429` controlada:
  - `Webhook temporariamente limitado. Tente novamente em instantes.`
- Registro de auditoria em excesso:
  - `entity_type=whatsapp_webhook`
  - `action=webhook_rate_limited`

Configuracao:

- `WEBHOOK_RATE_LIMIT_MAX` (staging final: `20`)
- `WEBHOOK_RATE_LIMIT_WINDOW_MS` (staging: `60000`)

Validacao:

- Requisicoes normais: `200`.
- Excesso em burst de teste: `429` confirmado.
- `audit_logs` com eventos `webhook_rate_limited` confirmados no Supabase.
- `/readyz` permaneceu `storage.mode=supabase` e `supabase.connected=true`.
- Painel staging preservado (`/login` e `/dashboard` com 200).

Confirmacoes:

- Sem alteracao de producao.
- Sem alteracao de Stripe/pagamentos.

## WhatsApp webhook - idempotencia minima

Data/hora: 2026-05-28 06:56 -03:00

Implementacao:

- Idempotencia aplicada em `POST /api/whatsapp/webhook`.
- Identificador aceito em ordem:
  - header `Idempotency-Key`
  - payload `rawMessage.messageId`
- Se identificador ja processado:
  - retorna `200` com `duplicate=true`
  - reaproveita resultado conhecido
  - nao cria novo atendimento

Auditoria:

- Evento de duplicidade ignorada:
  - `entity_type=whatsapp_webhook`
  - `action=webhook_duplicate_ignored`

Validacao:

- Primeiro envio com chave: cria atendimento.
- Segundo envio com mesma chave/messageId: sem duplicacao.
- `/readyz` permanece estavel.
- Painel staging preservado (`/login` e `/dashboard` com 200).

## WhatsApp webhook - correlation tracing minimo

Data/hora: 2026-05-28 06:59 -03:00

Implementacao:

- Header aceito: `X-Correlation-Id`.
- Se ausente, backend gera UUID automaticamente.
- Correlation id propagado em:
  - webhook (`POST /api/whatsapp/webhook`)
  - responses JSON principais (`correlationId`)
  - `audit_logs` relacionados
  - deliver (`POST /api/atendimentos/:id/deliver`)
  - prescriptions (`GET /api/prescriptions/:id` e `POST /api/prescriptions/:id/generate`)
  - logs estruturados backend (`http_request`)

Validacao:

- Request com `X-Correlation-Id`: retornou o mesmo valor.
- Request sem `X-Correlation-Id`: backend retornou UUID gerado.
- Rastreabilidade ponta a ponta confirmada em response + audit logs.
- `/readyz` permaneceu estavel.
- Painel staging preservado (`/login` e `/dashboard` com 200).

## WhatsApp webhook - cleanup stores em memoria

Data/hora: 2026-05-28 07:15 -03:00

Implementacao:

- Rate-limit store protegido com cap:
  - `RATE_LIMIT_MAX_BUCKETS`
  - prune/cleanup automatico para evitar crescimento infinito do `Map`
- Idempotency store em memoria com seguranca:
  - cache com TTL (`WEBHOOK_IDEMPOTENCY_TTL_MS`)
  - limite de entradas (`WEBHOOK_IDEMPOTENCY_MAX_ENTRIES`)
  - cleanup periodico automatico no backend

Garantias:

- Rate limit continua ativo em `POST /api/whatsapp/webhook`.
- Idempotencia continua ativa para `Idempotency-Key` / `messageId`.
- Sem impacto no fallback/mock.

## Validacao final E2E staging

Data/hora: 2026-05-28 07:24 -03:00

Escopo validado:

- Backend staging (`/health`, `/readyz`)
- Painel staging (`/login`, `/dashboard`)
- Supabase real (`storage.mode=supabase`, `supabase.connected=true`)
- Webhook seguro (`X-MDoctor-Webhook-Secret`)
- Idempotencia (`Idempotency-Key` + duplicate)
- Correlation tracing (`X-Correlation-Id` em header/body/audit)
- Rate limit (`429`)
- Prescription generate (mock)
- Delivery mock

Resultados:

- `POST /api/whatsapp/webhook` com headers de seguranca/correlation/idempotencia:
  - primeiro envio: `200`, atendimento criado
  - segundo envio com mesma chave: `200`, `duplicate=true`, sem duplicacao
- `POST /api/prescriptions/:id/generate`: `201`
- `POST /api/atendimentos/:id/deliver`: `200`, provider `mock`
- Status final do atendimento: `delivered`
- Persistencia em Supabase confirmada para atendimento e audit logs
- Evento auditado de duplicate: `webhook_duplicate_ignored`
- Evento auditado de rate limit: `webhook_rate_limited`

Persistencia apos restart:

- Backend staging reiniciado (redeploy controlado sem alteracao de codigo)
- Atendimento de teste permaneceu persistido com status `delivered`
- `/readyz` permaneceu com `mode=supabase` e `fallback_local=false`

Confirmacoes:

- Producao intacta
- Sem ativacao de Stripe/pagamentos
- Sem ativacao de WhatsApp provider real
- Sem ativacao de Memed producao

## Integracao n8n real staging (controlada)

Data/hora: 2026-05-28 07:35 -03:00

Objetivo:

- Executar validacao final da integracao n8n real com backend staging, mantendo provider WhatsApp real desativado.

Achado de infraestrutura:

- No Railway atual, o projeto `Automation-MDoctor` possui apenas ambiente `production` para o servico `n8n Node`.
- Nao foi encontrado ambiente/servico `n8n` de staging dedicado.
- Por seguranca, **nao** foi utilizada automacao n8n de production para testes de staging.

Validacao tecnica executada no backend staging (contrato n8n):

- `POST /api/whatsapp/webhook` com headers:
  - `X-MDoctor-Webhook-Secret`
  - `X-Correlation-Id`
  - `Idempotency-Key`
  - `Content-Type: application/json`
- Resultados:
  - primeiro envio: `200`, atendimento criado
  - segundo envio (mesma key): `200`, `duplicate=true`, sem duplicacao
  - sem secret: `401`
  - burst de carga: `429` confirmado
- `audit_logs` no Supabase confirmados para:
  - `webhook_processed`
  - `webhook_duplicate_ignored`
  - `webhook_rate_limited`
- Correlation tracing confirmado nos payloads auditados (`payload.correlationId`).

Estado dos endpoints:

- `/health`: 200
- `/readyz`: 200
- `/api/whatsapp/status`: 200
- Painel staging:
  - `/login`: 200
  - `/dashboard`: 200

Conclusao:

- Backend staging pronto para receber n8n real **quando existir runtime n8n staging dedicado**.
- Pendencia bloqueante para "n8n staging conectado": ausencia de servico/ambiente n8n staging no Railway.

Confirmacoes:

- Producao intacta
- Sem ativacao de Stripe
- Sem ativacao de WhatsApp provider real
- Sem ativacao de Memed producao

## WhatsApp provider staging - preparo controlado

Data/hora: 2026-05-28 07:38 -03:00

Diagnostico:

- Provider WhatsApp de staging ainda nao foi definido/configurado.
- Backend atual suporta envio real via Twilio quando credenciais existirem, mas staging permanece sem estas credenciais.
- Fluxo de delivery continua controlado em mock.

Contrato de envio preparado (target state):

- destinatario (E.164)
- mensagem
- link/PDF da receita
- status de envio
- erro
- retry
- correlationId
- audit log

Validacao do fluxo controlado (sem provider real):

- n8n/backend webhook: atendimento criado com `200`.
- Idempotencia: segundo envio com mesma key retornou `duplicate=true`.
- Delivery: `POST /api/atendimentos/:id/deliver` retornou `200` com `provider=mock`.
- Painel staging permaneceu operacional.

Conclusao:

- Provider definido: nao.
- Provider ativado em staging: nao.
- Fallback mock preservado: sim.
- Delivery controlado: OK.

## Memed - validacao controlada em staging (sem uso real)

Data/hora: 2026-05-28 09:14 -03:00

Objetivo:

- Validar integracao de prescricoes com seguranca maxima em staging.
- Nao usar dados reais de paciente.
- Nao disparar entrega real.
- Preservar fallback mock e evitar erro bruto 502 para o cliente.

Revisao da implementacao:

- `mdoctor-backend/src/services/memed.service.js`
  - Leitura de envs: `MEMED_ENV`, `MEMED_API_URL`, `MEMED_API_KEY`, `MEMED_SECRET_KEY`.
  - Sem credenciais validas, retorna mock controlado.
  - Em falha da Memed, aplica fallback mock com `warning`/`memedError`.
- `mdoctor-backend/src/routes/prescriptions.routes.js`
  - `POST /api/prescriptions/:id/generate` salva receita mesmo em fallback (`provider=mock`) e responde `201`.
  - Bloco `catch` retorna fallback controlado (`200`) com `code=PRESCRIPTION_GENERATE_FALLBACK`.
  - `GET /api/prescriptions/:id` retorna receita armazenada; sem armazenamento, cai em mock controlado.

Envs confirmadas para modo Memed real controlado (quando autorizado):

- `MEMED_ENV`
- `MEMED_API_URL`
- `MEMED_API_KEY`
- `MEMED_SECRET_KEY`

Estado atual de staging no momento da validacao:

- `MEMED_ENV=mock`
- `MEMED_ENVIRONMENT=development`
- `MEMED_ENABLED=false`
- Sem `MEMED_API_KEY` e `MEMED_SECRET_KEY` configuradas no backend staging.

Execucao controlada (somente ficticio):

- Backend staging base: `https://mdoctor-backend-staging-staging.up.railway.app`
- Painel staging: `https://painel-medico-staging-staging.up.railway.app`
- Atendimento criado com paciente ficticio (`Paciente Ficticio QA Memed`, CPF de teste, telefone/email de teste).
- Nao houve chamada de delivery.

Validacoes:

- `GET /health`: `200`
- `GET /readyz`: `200`
  - `storage.mode=supabase`
  - `supabase.connected=true`
  - `memed.source=mock`
  - `memed.env=mock`
- `POST /api/prescriptions/:id/generate` (atendimento ficticio): `201`
  - `source=mock`
  - `provider=mock`
  - `warning=Memed não configurada. Receita simulada para staging técnico.`
- `GET /api/prescriptions/:id`: `200`
  - `source=mock`
  - receita recuperada do storage (`storedId` presente)
- Painel staging:
  - `/login`: `200`
  - `/dashboard`: `200`

Conclusao da etapa:

- Memed real testada: nao (credenciais reais nao foram aplicadas nesta etapa).
- Fallback mock permaneceu ativo e funcional.
- Receita foi salva no Supabase em modo mock.
- Nenhum delivery real foi chamado.
- Producao Railway permaneceu intacta.

Procedimento seguro se credenciais Memed de producao forem fornecidas manualmente:

1. Configurar credenciais **somente** no backend staging (`mdoctor-backend-staging`).
2. Definir ambiente controlado:
   - `MEMED_ENV=production_controlled` (ou `production_staging`).
3. Fazer redeploy apenas do backend staging.
4. Reexecutar o mesmo teste com paciente/atendimento ficticios.
5. Se houver erro Memed, manter fallback mock e nao liberar fluxo real.

## E2E operacional completo - ciclo Typebot/n8n/backend/painel

Data/hora: 2026-05-28 09:20 -03:00

Objetivo:

- Validar fluxo operacional ponta a ponta:
  - Typebot staging-safe -> n8n staging -> backend staging -> Supabase -> painel -> prescription mock -> delivery mock.

Dados de teste utilizados:

- Somente dados ficticios.
- Paciente ficticio, CPF de teste, telefone de teste, email de teste.
- Doenca cronica elegivel e sem sinais de alerta.

Resultado por etapa:

1. Typebot -> n8n staging webhook:
   - Endpoint testado: `POST https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook`
   - Resultado: `404`
   - Resposta n8n: webhook nao registrado para rota de producao.
   - Evidencia: `"The requested webhook \"POST typebot-webhook\" is not registered."`
   - Impacto: bloqueia trecho Typebot -> n8n neste ciclo.

2. Backend staging (validacao operacional controlada):
   - `GET /health`: `200`
   - `GET /readyz`: `200`
   - `POST /api/auth/login`: `200`
   - `POST /api/whatsapp/webhook` com `X-MDoctor-Webhook-Secret`, `X-Correlation-Id`, `Idempotency-Key`:
     - primeira chamada: `200`, `duplicate=false`
     - segunda chamada (mesma key): `200`, `duplicate=true`
     - `correlationId` preservado nas duas respostas
   - Criacao de atendimento fallback para continuidade do E2E: `201`
   - `POST /api/prescriptions/:id/generate`: `201`, `source=mock`
   - `POST /api/atendimentos/:id/deliver`: `200`, `provider=mock`, status final `delivered`
   - `GET /api/prescriptions/:id`: `200`, `source=mock`

3. Supabase staging:
   - Persistencia operacional manteve-se ativa durante o ciclo.
   - Receita mock e transicoes de atendimento foram registradas via backend staging.

4. Painel staging:
   - `/login`: `200`
   - `/dashboard`: `200`
   - Sem regressao operacional durante o ciclo.

Analise do bloqueio:

- Causa: workflow n8n de producao URL (`/webhook/typebot-webhook`) nao ativo/publicado no runtime staging.
- Tipo: bloqueio externo de configuracao operacional (nao de codigo backend/painel).
- Correcao minima possivel sem mexer em producao: ativar/publicar workflow correspondente no n8n staging para registrar o webhook de producao.

Decisao nesta etapa:

- Nenhuma alteracao de codigo aplicada.
- Nenhuma mudanca em producao.
- Fluxo parcial validado com sucesso no backend/painel/Supabase em modo controlado.

## Correcao do bloqueio E2E - ativacao webhook typebot no n8n staging

Data/hora: 2026-05-28 09:35 -03:00

Problema de origem:

- `POST https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook`
- retorno `404` (`webhook not registered`)

Acao aplicada (somente staging):

- Workflow minimo criado/publicado no `n8n-staging` para:
  - `POST /webhook/typebot-webhook`
- Workflow implementa:
  - recepcao de payload Typebot
  - propagacao de `X-Correlation-Id`
  - propagacao de `Idempotency-Key`
  - chamada ao backend staging:
    - `POST /api/whatsapp/webhook`
  - header `X-MDoctor-Webhook-Secret`
  - resposta JSON ao caller

Validacao apos ativacao:

- `POST /webhook/typebot-webhook`: `200`
- backend staging criou atendimento
- repeticao da mesma key: `duplicate=true`
- `audit_logs` Supabase confirmados:
  - `webhook_processed`
  - `webhook_duplicate_ignored`
- painel staging `/dashboard`: `200`

Confirmacoes de seguranca:

- Nenhuma alteracao em backend/painel.
- Nenhuma alteracao em n8n producao.
- Nenhuma alteracao em producao Railway.
- Sem commit de secrets.

## Refinamento clinico inteligente do prontuario (staging)

Data/hora: 2026-05-28 10:xx -03:00

Evolucao aplicada:

- Elegibilidade conservadora para HAS/DM2/DLP/hipotireoidismo no backend.
- Inclusao de metadados clinicos aditivos (`criteriaUsed`, `riskLevel`, `protocolVersion`, `renewalStatus`).
- Geração de templates clinicos inteligentes (queixa, historia, exame telemedicina, conduta, orientacoes).
- Persistencia de rastreabilidade em `audit_logs.payload` e `atendimentos.dados_clinicos.clinical_audit`.
- Refino do prontuario no painel para exibir resumo, badges clinicos, timeline e trilha de auditoria.

Documentacao de referencia:

- `docs/PRONTUARIO-INTELIGENTE.md`
- `docs/PROTOCOLOS-CLINICOS-STAGING.md`

## Validacao clinica E2E pos-refinamento (staging)

Data/hora: 2026-05-28 10:26-10:40 -03:00

Contexto:

- Refinamento clinico implementado no commit `cba26c1`.
- Validacao executada em staging real, sem alteracao em producao.

Passos executados:

1. Validacoes tecnicas:
   - `npm --prefix mdoctor-backend run check` -> OK
   - `npm --prefix mdoctor-panel run lint` -> OK (warnings preexistentes fora do escopo)
   - `npm --prefix mdoctor-panel run build` -> OK
2. Endpoints staging:
   - backend `/health` -> `200`
   - backend `/readyz` -> `200`
   - backend `/api/atendimentos` -> `200`
   - painel `/login` -> `200`
   - painel `/dashboard` -> `200`
3. Casos clinicos ficticios:
   - HAS elegivel -> OK
   - DM2 elegivel -> OK
   - DLP elegivel -> OK
   - hipotireoidismo elegivel -> OK
   - sinais de alerta -> bloqueado (OK)
   - documentacao insuficiente -> bloqueado (OK)
   - medicacao incompativel/contraindicacao -> bloqueado (OK)
4. Campos clinicos validados:
   - `eligible`, `reason`, `reasonCode`, `criteriaUsed`, `riskLevel`, `renewalStatus`, `protocolVersion`
5. Persistencia e auditoria:
   - `dados_clinicos` com `protocol_version`, `clinical_summary`, `clinical_audit`
   - `audit_logs.payload` com `protocolVersion`, criterios e eventos (`webhook_processed`, `status_change`, `delivery_completed`)
6. Acoes operacionais:
   - aprovar elegivel -> OK
   - reprovar inelegivel -> OK
   - gerar Memed mock -> OK
   - delivery mock -> OK

Correcao minima aplicada no ambiente (sem alterar producao):

- Backend staging estava com comportamento pre-refinamento no inicio da rodada.
- Foi feito redeploy **somente** de `mdoctor-backend-staging` com o estado atual do branch (`cba26c1`), sem alterar contratos publicos.

Observacao:

- O webhook via n8n staging respondeu 200, mas nao preservou todo o enriquecimento de `rawMessage.original` para casos clinicos complexos; a validacao clinica completa foi realizada diretamente no webhook backend staging com secret e correlation id, sem mudar n8n/Typebot.

Confirmacoes de seguranca:

- Nenhuma alteracao em producao.
- Nenhuma ativacao de Stripe/WhatsApp real/Memed producao.
- Fallback/mock preservado.

## Evolution sandbox dry-run ativado (backend staging)

Data/hora: 2026-05-28 11:46 -03:00

Escopo executado:

- Configuracao de envs **somente** no servico `mdoctor-backend-staging`.
- Redeploy **somente** do backend staging.
- Sem alteracao em producao, painel, Stripe, Memed producao e WhatsApp real.

Variaveis configuradas no Railway (staging):

- `WHATSAPP_PROVIDER=evolution`
- `WHATSAPP_SANDBOX_MODE=true`
- `WHATSAPP_DRY_RUN=true`

Observacao de seguranca:

- `EVOLUTION_API_KEY` real nao foi configurada nesta etapa.

Validacao de endpoints:

- `GET /health`: `200`
- `GET /readyz`: `200`
- `GET /api/whatsapp/provider-status`: `200` com:
  - `provider=evolution`
  - `sandboxMode=true`
  - `dryRun=true`
  - `fallbackActive=true`
  - `mode=mock`
- `POST /api/whatsapp/test-send` com auth (`Bearer`): `200` com:
  - `delivery.provider=dry-run`
  - `delivery.providerStatus=simulated`
  - `warning` de simulacao ativa

Confirmacoes:

- Dry-run ativo: sim.
- Test-send OK: sim.
- Provider-status OK: sim.
- Mensagem real enviada: nao.
- Producao intacta: sim.
