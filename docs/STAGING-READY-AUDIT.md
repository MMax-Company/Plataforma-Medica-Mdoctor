# Staging Ready Audit - Doctor Prescreve

Data/hora: 2026-05-28 02:38:54 -03:00

## Escopo

Auditoria final pre-Railway staging do repositorio oficial:

```text
C:\Users\drmax\OneDrive\Área de Trabalho\Mdoctor-Survive
```

Branch auditada:

```text
codex/legacy-compat-infra
```

Nenhum projeto Railway foi alterado. Nenhum deploy foi executado.

## Commits principais confirmados

- `cb68745` - painel MVP.
- `3bd5216` - backend MVP.
- `ad61f4f` - Supabase storage.
- `f3e3b23` - backend staging readiness.
- `3ec3c2a` - staging preparation.
- `0e8bf83` - pendencias pagamentos/WhatsApp.
- `007af3b` - Railway staging setup guide.
- `e4bbc27` - Railway staging deployment guide.
- `13c268b` - complete staging plan.
- `a927391` - Railway staging execution guide.
- `43d6f6a` - Railway autosetup guide.
- `4b775f1` - final Railway staging runbook.

## Status do working tree

Antes da geracao deste documento, o working tree estava limpo e a branch estava alinhada com `origin/codex/legacy-compat-infra` apos o push do commit `43d6f6a`.

Arquivos ignorados locais observados:

- `.env` e `.env.local` locais.
- `node_modules`.
- `.next`.
- `.vscode`.

Esses itens nao estavam staged.

## Arquivos criticos verificados

Backend:

- `mdoctor-backend/package.json`
- `mdoctor-backend/Dockerfile`
- `mdoctor-backend/.env.example`
- `mdoctor-backend/.env.staging.example`
- `mdoctor-backend/src/config/readiness.js`
- `mdoctor-backend/src/config/supabase.js`
- `mdoctor-backend/src/services/memed.service.js`
- `mdoctor-backend/src/routes/prescriptions.routes.js`
- `mdoctor-backend/src/routes/atendimentos.routes.js`

Painel:

- `mdoctor-panel/package.json`
- `mdoctor-panel/Dockerfile`
- `mdoctor-panel/.dockerignore`
- `mdoctor-panel/.env.example`
- `mdoctor-panel/src/services/api.ts`
- `mdoctor-panel/src/services/auth.service.ts`
- `mdoctor-panel/src/services/patients.ts`
- `mdoctor-panel/src/services/prescriptions.ts`

Docs:

- `docs/RAILWAY-STAGING-SETUP.md`
- `docs/RAILWAY-STAGING-CHECKLIST-MANUAL.md`
- `docs/RAILWAY-STAGING-EXECUCAO-PASSO-A-PASSO.md`
- `docs/RAILWAY-STAGING-CHECKLIST-OPERACIONAL.md`
- `docs/RAILWAY-STAGING-AUTOSETUP.md`
- `docs/PLANO-STAGING-COMPLETO-MDOCTOR.md`
- `docs/PENDENCIAS-PAGAMENTOS-WHATSAPP.md`
- `mdoctor-backend/SUPABASE_SETUP.md`
- `DEPLOY-PRODUCAO.md`

## Checks executados

- `npm --prefix mdoctor-backend run check`
- `npm --prefix mdoctor-panel run build`
- `npm --prefix mdoctor-panel run lint`
- `npm run pre-github-check`

Resultado:

- Backend check: passou.
- Painel build: passou.
- Painel lint: passou com 2 warnings antigos conhecidos de `react-hooks/exhaustive-deps`, 0 erros.
- Pre-github check: passou, com avisos apenas sobre `.env` locais ignorados.

## Riscos encontrados

- Existe URL Railway hardcoded antiga em `mdoctor-panel/src/config/api.ts`. Ela e sobrescrita por `NEXT_PUBLIC_API_URL`, portanto nao bloqueia staging se `NEXT_PUBLIC_API_URL` for configurada antes do build do painel.
- Existem `.env` reais locais ignorados. Eles nao estao staged e nao devem ser enviados ao GitHub.
- `mdoctor-panel/.env.local.example` aparece como ignorado localmente; nao deve ser tratado como requisito bloqueante do staging atual.

## Pendencias bloqueantes

Nenhuma pendencia bloqueante identificada para criar staging manual, desde que:

- `NEXT_PUBLIC_API_URL` seja configurada no painel staging.
- Nenhum segredo seja colocado no painel.
- Railway production e dominios oficiais nao sejam alterados.

## Pendencias nao bloqueantes

- Supabase real ainda precisa ser aplicado e validado para persistencia real.
- Memed sandbox ainda precisa ser validada depois do staging base.
- WhatsApp/n8n real fica para fase futura.
- Stripe/pagamentos ficam fora desta etapa e devem seguir `docs/PENDENCIAS-PAGAMENTOS-WHATSAPP.md`.
- Lint do painel pode manter warnings antigos conhecidos, desde que nao haja erro.

## Proximos passos manuais no Railway

1. Criar `Backend-MDoctor-Staging`.
2. Usar branch `codex/legacy-compat-infra`.
3. Configurar root `mdoctor-backend`.
4. Configurar envs staging do backend.
5. Deployar backend somente apos confirmacao manual.
6. Validar `/health` e `/readyz`.
7. Criar `Painel-MDoctor-Staging`.
8. Configurar root `mdoctor-panel`.
9. Configurar `NEXT_PUBLIC_API_URL` com a URL do backend staging.
10. Deployar painel somente apos confirmacao manual.
11. Validar `/login`, `/dashboard`, prontuario, Memed mock e entrega mock.

## Decisao final

Pronto para Railway staging manual assistido: sim, condicionado a configurar `NEXT_PUBLIC_API_URL` no painel staging antes do build e manter producao intocada.
