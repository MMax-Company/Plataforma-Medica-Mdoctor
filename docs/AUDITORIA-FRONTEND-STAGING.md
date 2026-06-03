# Auditoria urgente — frontend staging (2026-06-01)

## Veredito

**A suspeita está CORRETA em parte:** o URL `painel-medico-staging-staging.up.railway.app` serve **Next.js** do monorepo `Plataforma-Medica-Mdoctor`, mas **NÃO o commit/build atual** do workspace local. O bundle publicado é **anterior** ao painel definitivo (logo, Memed UX, prontuário).

**Não é** o HTML legado `painel-medico.html` (servido por outro stack).

**Risco documentado:** o serviço **Painel Medico** (produção) no Railway ainda pode apontar para repo **`Mdoctor-Prescreve`** (legado) — ver `docs/TRANSICAO-RAILWAY-GITHUB.md`. O **staging** (`painel-medico-staging`) deve usar `railway up` de `mdoctor-panel` neste repo.

---

## 1. Identificação (workspace local)

| Campo | Valor |
|-------|--------|
| Repositório | `https://github.com/MMax-Company/Plataforma-Medica-Mdoctor.git` |
| Branch | `codex/legacy-compat-infra` |
| Commit HEAD | `3fbf42b0334533fbe251793601c7625ca19516da` |
| Mensagem | `fix: estabilidade memed homologação` |
| App frontend | `mdoctor-panel/` (Next.js 14) |
| Backend staging | `mdoctor-backend-staging` — `https://mdoctor-backend-staging-staging.up.railway.app` |

---

## 2. Serviços Railway (mapa)

| Serviço | Projeto | URL | Repo alvo (oficial) | Não tocar |
|---------|---------|-----|---------------------|-----------|
| **painel-medico-staging** | Painel-MDoctor `faae345a-...` | https://painel-medico-staging-staging.up.railway.app | **Plataforma-Medica-Mdoctor** / `mdoctor-panel` | — |
| **mdoctor-backend-staging** | Backend-Mdoctor | https://mdoctor-backend-staging-staging.up.railway.app | `mdoctor-backend` | — |
| **web** | Backend-Mdoctor | https://web-production-5f178.up.railway.app | `mdoctor-backend` (prod) | homologação UI |
| **Painel Medico** | Painel-MDoctor | (domínio prod) | ⚠️ doc: ainda **Mdoctor-Prescreve** legado | confundir com staging |

Service ID painel staging: `626fc9d2-3f6a-417c-b3a7-e3e21846edb8`

---

## 3. Git / Railway CLI

```text
git remote -v  → origin Plataforma-Medica-Mdoctor
git branch     → codex/legacy-compat-infra
git rev-parse HEAD → 3fbf42b...
railway status → Unauthorized (rodar railway login localmente)
```

---

## 4. Evidência: staging ≠ código local

| Marcador | **Staging no ar** | **Código local (HEAD)** |
|----------|-------------------|-------------------------|
| Login logo | `logotipo-mdoctor` no chunk JS | `doctor-prescreve-logo-transparent.png` |
| Memed UX | sem `Pronto para emitir`, sem `memedRuntime` | presente em `useMemedSinapse.ts` |
| Memed script API | `partners.../integration.js` | default Sinapse em `memed.routes.js` |
| Banner auditoria | ausente | adicionado nesta auditoria |

Chunk login staging: `app/login/page-ff914915395c2013.js` (hash antigo).

**Atualização 2026-06-02:** build local OK após `npm install` + limpar `.next`. Chunk login local: `page-62f71399ff1cfde7.js`. Staging **ainda** `page-ff914915395c2013.js` e sem banner V2 — deploy pendente (`railway login` + `railway up`).

---

## 5. Frontends no monorepo

| Path | Tipo |
|------|------|
| `mdoctor-panel/` | **Painel novo** (Next.js) — único alvo staging |
| `mdoctor-backend/public/painel-medico*.html` | Legado (não usar no staging panel URL) |
| `mdoctor-backend/` | API apenas |

Não há segundo Next.js de painel na raiz.

---

## 6. Marcador visual temporário (deploy)

Incluído em `mdoctor-panel`:

- Banner vermelho fixo: **PAINEL NOVO V2**
- Footer: commit + ISO build time
- Fundo gradiente laranja/clínico (`staging-audit-body`)
- `scripts/write-build-env.js` + `prebuild`

**Após `railway login` + deploy painel**, a tela DEVE exibir o banner. Se não aparecer → deploy no serviço errado ou cache CDN.

---

## 7. Deploy (somente painel staging)

```powershell
cd mdoctor-panel
railway login
railway link   # projeto Painel-MDoctor, env staging, service painel-medico-staging
railway up --detach -p 3bec26a7-422e-40ae-8763-2a4c5158fef4 -e staging -s painel-medico-staging
```

Aguardar build ~2–5 min. Validar:

1. https://painel-medico-staging-staging.up.railway.app/login — banner vermelho + footer com `3fbf42b...`
2. Logo Doctor Prescreve (transparente), não logo branco antigo só no Brand legado
3. Não continuar Memed até confirmar

---

## 8. Confirmação explícita

- SEM MOCK / SEM FALLBACK FAKE (inalterado nesta auditoria)
- STAGING ONLY — não alterar `web` production
- **Pare Memed/WhatsApp** até banner V2 visível no browser
