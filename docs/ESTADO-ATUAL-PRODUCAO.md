# Estado atual de produção

Última atualização: 21/08/2026 (America/Sao_Paulo)

## Código oficial

- Repositório: `MMax-Company/Plataforma-Medica-Mdoctor`
- Produção: branch `main`
- Homologação: branch `staging`
- Produção validada: `30c5742359c53330288aaa46588ce3864d22d585`
- Homologação validada: `13a1d5fe6f067bbfd5a9a894d10add72a456fad4`
- As árvores Git dos dois commits são idênticas:
  `6d0eb87a2d4edafc525c2dbd9345597e7d68096f`
- Pull Request de normalização: #45
- Pull Request de CI/homologação: #46
- Pull Request de promoção para produção: #47
- Pull Request anterior #43: encerrado após revisão da estratégia

## Estratégia de branches

- `main`: fonte oficial de produção. Mudanças somente por Pull Request.
- `staging`: fonte oficial de homologação. Mudanças somente por Pull Request.
- `feature/*`, `fix/*`, `chore/*` e `docs/*`: branches temporárias.
- Promoção: branch temporária → `staging` → validação → Pull Request `staging` → `main`.

As proteções de `main` e `staging` exigem Pull Request, histórico linear e resolução das conversas. Force-push e exclusão estão bloqueados, inclusive para administradores.

O workflow `CI` verifica segurança básica do repositório, sintaxe do backend,
lint e build do painel em Pull Requests para `main` e `staging`. Os checks
`Repository safety`, `Backend check` e `Panel lint and build` são obrigatórios
nas duas branches.

## Railway

| Ambiente | Componente | Branch acompanhada | URL |
| --- | --- | --- | --- |
| Produção | Backend | `main` | https://web-production-5f178.up.railway.app |
| Produção | Painel médico | `main` | https://web-production-02fde.up.railway.app |
| Homologação | Backend | `staging` | https://mdoctor-backend-staging-staging.up.railway.app |
| Homologação | Painel médico | `staging` | https://painel-medico-staging-staging.up.railway.app |

Os quatro serviços acompanham automaticamente a ponta de suas branches; não existe `commitSha` fixo. Variáveis, domínios e demais configurações foram preservados durante o alinhamento.

## Última validação

Executada em 21/08/2026 após os PRs #46 e #47 e os deploys automáticos:

- Backend de produção: deployment
  `1f5774c8-6b3a-4363-8996-4bbf85d489ac`, `SUCCESS`; `/health` e `/readyz`
  OK, sem falhas ou avisos.
- Painel de produção: deployment
  `3796f02a-113d-4bb8-a995-bb81985d8d87`, `SUCCESS`.
- Backend de homologação: deployment
  `389cb627-90eb-4282-a7d6-bb9208af22c6`, `SUCCESS`.
- Painel de homologação: deployment
  `bb8ef43d-1067-4975-bae0-ff4d8614d8e2`, `SUCCESS`.
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
