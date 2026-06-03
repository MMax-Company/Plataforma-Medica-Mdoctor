# LEGADO — NÃO USAR EM STAGING NEM HOMOLOGAÇÃO

Esta pasta documenta artefatos e serviços **fora** do Doctor Prescreve oficial.

## Oficial (único alvo de deploy UI)

| Item | Valor |
|------|--------|
| Repositório | `MMax-Company/Plataforma-Medica-Mdoctor` |
| Branch | `codex/legacy-compat-infra` |
| Frontend | `mdoctor-panel/` |
| Railway painel staging | `painel-medico-staging` |
| URL | https://painel-medico-staging-staging.up.railway.app |

## Legado — ignorar para UI

| Item | Classificação | Ação |
|------|---------------|------|
| Repo `MMax-Company/Mdoctor-Prescreve` | LEGADO | Não apontar `painel-medico-staging` para este repo |
| `public/painel-medico.html` (repo legado) | LEGADO | Não existe neste monorepo; se aparecer em outro clone, não deployar |
| Serviço Railway **Painel Medico** (prod) | PRODUCTION / LEGADO até migração | Não confundir com `painel-medico-staging` |
| Serviço **web** | PRODUCTION backend | Não é painel; `/login` retorna 404 |
| Logo `logotipo-mdoctor.png` em `Brand.tsx` antigo | ARQUIVAR | Substituído por `doctor-prescreve-logo-transparent.png` |

## Regra

Se o banner **PAINEL NOVO V2 — DOCTOR PRESCREVE OFICIAL** não aparecer no staging, o deploy está **ERRADO**.
