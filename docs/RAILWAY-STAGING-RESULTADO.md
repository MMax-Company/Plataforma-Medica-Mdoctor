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

## Confirmacoes

- Producao nao foi alterada.
- Railway nao recebeu deploy.
- Railway nao recebeu novas variaveis.
- Nenhum dominio oficial foi alterado.
- Memed real nao foi ativada.
- WhatsApp real nao foi ativado.
- Stripe/pagamentos nao foram ativados.
- Codigo funcional nao foi alterado.
