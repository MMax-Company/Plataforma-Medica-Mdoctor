# Fase 1 — Fechamento staging (publicação e estabilização)

## Comando único (local)

```bash
# Variáveis (não commitar tokens)
export TYPEBOT_API_TOKEN=...
export N8N_WEBHOOK_SECRET=...
# opcional: export N8N_API_KEY=...

node mdoctor-backend/scripts/fase1-staging-deploy.js
```

## Passos manuais Railway

### Backend staging (`mdoctor-backend-staging`)

```bash
cd mdoctor-backend
railway link   # projeto Backend-Mdoctor, env staging, serviço mdoctor-backend-staging
railway up --detach
```

Ou push na branch conectada ao serviço staging (deploy automático).

### Painel staging (`painel-medico-staging`)

Rebuild após backend publicado (variáveis `NEXT_PUBLIC_API_URL` apontando para backend staging).

## Checklist pós-deploy

| Item | Validação |
|------|-----------|
| Typebot publicado | `doctor-prescreve-8rmljgu` abre fluxo com foto obrigatória |
| n8n typebot-webhook | ativo; normaliza `birth_date` |
| Backend | `/health` 200; webhook rejeita não pago |
| Fila médica | `GET /api/atendimentos?scope=medical` só elegível+pago |
| Suporte | menu `2` → faixa suporte; não mistura com fila médica |
| Aprovar/Reprovar | prontuário → API clinical/approve|reject |

## Scripts

| Script | Uso |
|--------|-----|
| `publish-typebot-staging.js` | PATCH + publish bot existente |
| `fase1-staging-deploy.js` | orquestra validação + n8n + typebot + smoke |
| `embed-n8n-typebot-payload.js` | atualiza code node no JSON n8n |
| `test-fase1-payload-normalizer.js` | testes locais normalização |

## Status implantação (2026-05-29)

| Item | Status |
|------|--------|
| Backend `mdoctor-backend-staging` redeploy | ✅ `SUCCESS` — deploy `3f39193f-8847-4ff8-9390-5c8b4b72b23b` |
| n8n `typebot-webhook-staging` | ✅ ativo (`MKlb7XUycILq2p3a`) |
| n8n `clinical-rejection-notify-staging` | ✅ ativo |
| n8n `Evolution Webhook - Staging` | ✅ ativo (menu WhatsApp) |
| Smoke backend (pago/elegível, não pago, sem foto) | ✅ `node mdoctor-backend/scripts/smoke-fase1-staging.js` |
| Typebot publicado via API | ⏳ requer `TYPEBOT_API_TOKEN` local |

### Publicar Typebot (ação manual)

```bash
export TYPEBOT_API_TOKEN=...   # token do builder Typebot (Settings → API tokens)
node mdoctor-backend/scripts/publish-typebot-staging.js
```

## Fase 1 encerrada quando

- [ ] Typebot publicado em staging (API token)
- [x] Workflows n8n republicados e ativos
- [x] Backend staging redeployado com código Fase 1
- [x] Smoke backend elegível/pago e bloqueios OK
- [ ] Painel staging rebuild (se ainda não publicado com Fase 1 UI)
