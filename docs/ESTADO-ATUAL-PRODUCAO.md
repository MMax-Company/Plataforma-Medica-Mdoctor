# Estado atual de produção

Última atualização: 21/08/2026 (America/Sao_Paulo)

## Código oficial

- Repositório: `MMax-Company/Plataforma-Medica-Mdoctor`
- Produção: branch `main`
- Homologação: branch `staging`
- Commit validado em ambos os ambientes: `510715aca2aba88a459c28c49e06f48db2052aa3`
- Pull Request de normalização: #45
- Pull Request anterior #43: encerrado após revisão da estratégia

## Estratégia de branches

- `main`: fonte oficial de produção. Mudanças somente por Pull Request.
- `staging`: fonte oficial de homologação. Mudanças somente por Pull Request.
- `feature/*`, `fix/*`, `chore/*` e `docs/*`: branches temporárias.
- Promoção: branch temporária → `staging` → validação → Pull Request `staging` → `main`.

As proteções de `main` e `staging` exigem Pull Request, histórico linear e resolução das conversas. Force-push e exclusão estão bloqueados, inclusive para administradores.

Ainda não há workflow de CI próprio no repositório. Por isso, nenhum status check foi configurado como obrigatório; criar uma suíte automatizada é a próxima melhoria recomendada.

## Railway

| Ambiente | Componente | Branch acompanhada | URL |
| --- | --- | --- | --- |
| Produção | Backend | `main` | https://web-production-5f178.up.railway.app |
| Produção | Painel médico | `main` | https://web-production-02fde.up.railway.app |
| Homologação | Backend | `staging` | https://mdoctor-backend-staging-staging.up.railway.app |
| Homologação | Painel médico | `staging` | https://painel-medico-staging-staging.up.railway.app |

Os quatro serviços acompanham automaticamente a ponta de suas branches; não existe `commitSha` fixo. Variáveis, domínios e demais configurações foram preservados durante o alinhamento.

## Última validação

Executada em 21/08/2026 após o alinhamento do Railway:

- Backend de produção: `/health` OK e `/readyz` OK, sem falhas ou avisos.
- Supabase conectado e persistência ativa.
- Memed em modo real de produção, sem fallback simulado.
- Painel: login, fila e dashboard responderam HTTP 200.
- Autenticação e consulta de atendimentos aprovadas; 18 registros retornados.
- Homologação aprovada; único aviso esperado: `NODE_ENV` diferente de `production`.

## Referências de segurança

Manter temporariamente:

- `backup/backend-prod-20260821`
- `backup/painel-prod-20260821`
- `backup/producao-pre-deploy-20260728-branch`

Revisar a necessidade dessas referências até 04/09/2026. Excluir somente depois de confirmar estabilidade e existência de tags/releases suficientes para recuperação.

## Serviços adjacentes

Os projetos Railway `Typebot-MDoctor` e `Automation-MDoctor` continuam fora do escopo desta normalização. O estado de bots, workflows n8n e integrações externas deve ser auditado separadamente antes de ser declarado neste documento.
