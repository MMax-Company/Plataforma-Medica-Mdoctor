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
