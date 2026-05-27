# Transicao Railway -> GitHub

Este documento e a referencia operacional para impedir confusao entre os repositorios `Mdoctor-Prescreve` e `Plataforma-Medica-Mdoctor`.

## Decisao oficial

O repositorio oficial para evolucao do produto e:

- `MMax-Company/Plataforma-Medica-Mdoctor`

O repositorio abaixo deve ser tratado como legado de producao enquanto os servicos Railway ainda estiverem apontando para ele:

- `MMax-Company/Mdoctor-Prescreve`

Nao apagar, renomear ou desativar o legado antes da migracao completa e validada em Railway.

## Estado confirmado em 2026-05-26

GitHub:

- `Mdoctor-Prescreve`
  - ultimo commit: `40cf1569a39a963a7ad3ade80504551fd2c62e1a`
  - mensagem: `fix: remove temp-ref submodule`
  - data: `2026-05-20T23:58:01Z`
- `Plataforma-Medica-Mdoctor`
  - ultimo commit: `3b0975a193508b170e0eea3c79150213f1b434ef`
  - mensagem: `Harden legacy receitas RLS`
  - data: `2026-05-26T06:28:50Z`

Railway:

- `Backend-Mdoctor / web`
  - status: `SUCCESS`
  - source repo atual: `MMax-Company/Mdoctor-Prescreve`
  - start command atual: `node src/server.js`
- `Painel-MDoctor / Painel Medico`
  - status: `SUCCESS`
  - source repo atual: `MMax-Company/Mdoctor-Prescreve`
  - start command atual: `npm start`
- `Automation-MDoctor / mdoctor-automation`
  - status: `SUCCESS`
  - source repo nao exibido pela consulta Railway

## Arquitetura alvo

Cada servico Railway deve apontar para o repositorio oficial, com root directory especifico:

| Railway project | Railway service | Repo alvo | Root directory | Health check |
| --- | --- | --- | --- | --- |
| `Backend-Mdoctor` | `web` | `MMax-Company/Plataforma-Medica-Mdoctor` | `mdoctor-backend` | `/health` |
| `Painel-MDoctor` | `Painel Medico` | `MMax-Company/Plataforma-Medica-Mdoctor` | `mdoctor-panel` | `/login` |
| `Automation-MDoctor` | `mdoctor-automation` | `MMax-Company/Plataforma-Medica-Mdoctor` | `mdoctor-automation` | `/healthz` |

## Regra de ouro

Antes de mudar qualquer source repo no Railway:

1. Rodar `npm run pre-github-check`.
2. Rodar `npm --prefix mdoctor-backend run check`.
3. Rodar `npm --prefix mdoctor-panel run build`.
4. Rodar `npm --prefix mdoctor-automation run check`.
5. Conferir variaveis Railway do servico que sera migrado.
6. Migrar um servico por vez.
7. Validar health check e rota operacional do servico migrado.
8. Aguardar logs estabilizarem antes de passar ao proximo servico.

## Ordem segura de migracao

1. Automation, se nao for dependencia critica do atendimento vivo no momento.
2. Painel, porque rollback visual e mais simples se backend continuar intacto.
3. Backend por ultimo, porque e o servico clinico principal e concentra risco.

Se houver atendimento real em andamento, congelar migracao do backend.

## Analise do legado `Mdoctor-Prescreve`

O legado possui itens que precisam ser preservados ou reavaliados antes de migrar:

- assets de marca em `public/assets`;
- painel HTML legado em `public/painel-medico.html` e `public/painel-medico-premium.html`;
- rotas Express antigas em `src/routes`;
- controllers antigos em `src/controllers`;
- servicos antigos em `src/services`;
- utilitario de criptografia em `src/utils/crypto.js`;
- configuracao Docker/Railway legado;
- integracao Supabase hibrida em `src/db-supabase-hybrid.js`.

Esses itens nao devem ser copiados cegamente. A regra e comparar funcao por funcao contra os modulos atuais:

- backend novo: `mdoctor-backend`;
- painel novo: `mdoctor-panel`;
- automacao nova: `mdoctor-automation`;
- docs e SQL: `docs`.

## Itens que bloqueiam a troca definitiva

- Railway ainda apontando para `Mdoctor-Prescreve`.
- Backend oficial sem paridade de rotas criticas usadas pelo fluxo real.
- Painel oficial sem login, fila, atendimento e receita funcionando.
- Memed nao validada no ambiente oficial.
- Variaveis de producao incompletas.
- CORS apontando para dominio antigo.
- Ausencia de rollback documentado.

## Rollback

Se um servico migrado falhar:

1. Nao migrar outros servicos.
2. Voltar o source repo/root directory do servico afetado para o estado anterior.
3. Confirmar health check.
4. Registrar o erro e o deployment que falhou.
5. Corrigir no repositorio oficial antes de nova tentativa.
