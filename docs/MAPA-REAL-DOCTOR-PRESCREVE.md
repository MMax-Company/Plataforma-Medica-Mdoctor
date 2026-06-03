# Mapa real — Doctor Prescreve (recuperação operacional)

**Gerado:** recuperação FASE 1–8 · branch `codex/legacy-compat-infra`

---

## Classificação

| Tag | Significado |
|-----|-------------|
| **OFICIAL** | Único alvo de homologação e evolução |
| **LEGADO** | Não deployar; não usar para UI staging |
| **PRODUCTION** | Produção real — não alterar nesta recuperação |
| **IGNORAR** | Scripts/docs auxiliares, não são frontend |
| **ARQUIVAR** | Referência histórica apenas |

---

## OFICIAL

| Camada | Identificador |
|--------|----------------|
| Repositório | `https://github.com/MMax-Company/Plataforma-Medica-Mdoctor.git` |
| Branch | `codex/legacy-compat-infra` |
| Commit referência | `3fbf42b0334533fbe251793601c7625ca19516da` |
| Frontend | `mdoctor-panel/` (Next.js 14) |
| Backend staging | serviço `mdoctor-backend-staging` · projeto `bed0e3b3-...` |
| Backend staging URL | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel staging | serviço `painel-medico-staging` · projeto `3bec26a7-...` |
| Painel staging URL | `https://painel-medico-staging-staging.up.railway.app` |
| Supabase | `usihurogvphtjedyhyfl` (us-west-2) |

### Assets oficiais (painel)

- Logo: `/doctor-prescreve-logo-transparent.png`
- Login: `src/app/login/page.tsx`
- Prontuário: `src/app/prontuario/[id]/`, `ProntuarioMedicalHeader.tsx`
- Memed: `src/app/receita/`, `src/lib/memed/*`, `useMemedSinapse.ts`
- Marcador deploy: `src/components/staging/StagingBuildMarker.tsx`

### Variáveis críticas painel (Railway `painel-medico-staging`)

- `NEXT_PUBLIC_API_URL` → backend staging
- `NEXT_PUBLIC_APP_ENV=staging`
- `NEXT_PUBLIC_MEMED_REAL_ENABLED=true`
- `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false`

### Variáveis críticas backend (`mdoctor-backend-staging`)

- `SUPABASE_URL` → projeto `usihurogvphtjedyhyfl`
- `MEMED_REAL_ENABLED=true`
- `MEMED_PRESCRITOR_EXTERNAL_ID` (prioridade absoluta)
- `CORS_ORIGIN` → URL do painel staging

---

## LEGADO

| Item | Motivo |
|------|--------|
| Repo `MMax-Company/Mdoctor-Prescreve` | Monorepo antigo; Railway **Painel Medico** prod ainda documentado como apontando aqui |
| `public/painel-medico.html` | HTML Express legado (não neste workspace) |
| `logotipo-mdoctor.png` em `Brand.tsx` (versão antiga) | Logo branco antigo — **corrigido no código oficial** |
| Chunk JS `app/login/page-ff914915395c2013.js` no staging | **Build antigo no ar** (evidência deploy desatualizado) |

---

## PRODUCTION (não tocar)

| Serviço | URL / nota |
|---------|------------|
| `web` | `https://web-production-5f178.up.railway.app` — API backend produção |
| `Painel Medico` | Painel produção — repo legado até migração documentada |
| Supabase legado | `thbwoogytwcidxrrboym` — **não usar** |

---

## IGNORAR (não são o painel UI)

- `mdoctor-automation/`
- `mdoctor-backend/scripts/*` (exceto API)
- `docs/playwright-artifacts/`
- Screenshots em `docs/screenshots/`

---

## Estado do ar vs código (auditoria)

| Check | Staging no ar (última medição) | Código local HEAD |
|-------|------------------------------|-------------------|
| Banner V2 oficial | **ERRO** — ausente | **CONFIRMADO** no build local |
| Logo login | **ERRO** — `logotipo-mdoctor` no chunk | **CONFIRMADO** — `doctor-prescreve-logo-transparent` |
| Memed UX nova | **ERRO** — chunks sem `memedRuntime` | **CONFIRMADO** no source |
| Next.js framework | **CONFIRMADO** — título Doctor Prescreve | **CONFIRMADO** |
| Serviço URL | **CONFIRMADO** — painel-medico-staging URL | — |

**Conclusão:** URL correta, **deploy incorreto/desatualizado**.

---

## Deploy definitivo (único comando aceito para painel staging)

```powershell
cd mdoctor-panel
railway login
railway link   # Painel-MDoctor → staging → painel-medico-staging
railway up --detach -p 3bec26a7-422e-40ae-8763-2a4c5158fef4 -e staging -s painel-medico-staging
```

Validação pós-deploy:

```powershell
node scripts/audit-staging-live.js
```

Critério de sucesso: `verdict: "NO_AR_OFICIAL"`.

---

## Fases Memed / WhatsApp / Stripe

**CONGELADAS** até `verdict: NO_AR_OFICIAL` no painel.

---

## Referências

- `legacy/README.md`
- `docs/AUDITORIA-FRONTEND-STAGING.md`
- `docs/TRANSICAO-RAILWAY-GITHUB.md`
- `REPOSITORY-OFFICIAL.md` (se existir)
