# Validação de autenticação — painel médico (pré-homologação humana)

> Atualizado: 2026-06-03  
> Ambiente: staging Railway  
> Backend: `https://mdoctor-backend-staging-staging.up.railway.app`  
> Painel: `https://painel-medico-staging-staging.up.railway.app`

## Veredito final

**Painel apto para homologação humana** — login, sessão, refresh, APIs protegidas e fluxo UI validados em staging.

| Área | Status |
|------|--------|
| Login (`drmax.matos`) | OK |
| Sessão / JWT 8h | OK |
| Refresh token | OK |
| Logout (localStorage) | OK |
| APIs 401 sem token / token inválido | OK |
| Rotas `/fila`, atendimento, receita, admin | OK |
| Build + lint | OK |
| Playwright fila pós-login | OK |

Relatório técnico completo: `docs/AUTH-TOUR-TECNICO-RELATORIO.md` (0 falhas na última execução).

---

## Arquitetura (sem alterações)

- **Auth:** JWT emitido pelo backend (`POST /api/auth/login`), não Supabase Auth no painel.
- **Armazenamento:** `localStorage` — `mdoctor_auth_token`, `mdoctor_auth_user`.
- **Proxy:** `next.config.mjs` reescreve `/api/*` → backend staging.
- **Guard UI:** `requireSession()` + `AuthSessionBootstrap` (refresh ~30 min antes do `exp`).
- **Limitação aceita:** sem `middleware.ts` Next — HTML de `/fila` retorna 200, mas **dados só via API com Bearer** (401 sem sessão).

Rotas públicas: `/login`, `/upload-receita/[token]`.

---

## Testes executados (2026-06-03)

```powershell
cd mdoctor-panel
node scripts/run-auth-tour-local.js

cd ..
node scripts/run-painel-funcional-local.js

cd mdoctor-panel
npm run build
npm run lint
```

### Auth tour — todos OK

- Login backend e proxy painel
- JWT válido (8h, role admin)
- `GET /api/auth/me` (backend + proxy)
- `POST /api/auth/refresh` (novo token)
- Fila API autenticada (70 atendimentos no teste)
- Approve sem token → 401; com token → autenticado (não 401)
- `admin/admin123` bloqueado
- `/api/admin/status` com role admin
- Logout limpa `localStorage`

### Playwright

- Login UI → `/fila` com pacientes elegíveis visíveis

---

## Credenciais: atenção dev vs staging

| Contexto | `MEDICO_USER` típico |
|----------|----------------------|
| `.env.local` (dev) | `admin` |
| Railway staging | `drmax.matos` |

O tour automatizado usa **`drmax.matos`** + `MEDICO_PASS` do `.env.local` (senha alinhada ao Railway). Não usar `admin` contra staging — retorna 401.

---

## Segurança

| Item | Status |
|------|--------|
| Secrets em `src/` | Nenhum |
| `JWT_SECRET` / `MEDICO_PASS` no frontend | Não expostos |
| `.env*` no git | Ignorados |
| Fallback `admin123` no backend | Ausente |
| Scripts probe com senha hardcoded | **Corrigido** — exigem `MEDICO_PASS` |

---

## Checklist homologação humana (browser)

1. `https://painel-medico-staging-staging.up.railway.app/login`
2. Login: **drmax.matos** + senha do Railway
3. F5 — sessão mantida
4. Fila → atendimento → receita
5. Logout → login novamente
6. Network: `Authorization: Bearer` nas APIs; sem 401 inesperado

---

## Comandos úteis

| Comando | Uso |
|---------|-----|
| `node mdoctor-panel/scripts/run-auth-tour-local.js` | Tour API auth staging |
| `node scripts/run-painel-funcional-local.js` | E2E fila + login UI |
| `node mdoctor-panel/scripts/probe-staging-login-users.js` | Diagnóstico rápido de usuário/senha |

---

## Correções aplicadas nesta validação

1. `probe-auth-staging.js` / `probe-cors-staging.js` — removida senha hardcoded.
2. `run-auth-tour-local.js` — usa `drmax.matos` no staging (não sobrescreve com `admin` do `.env.local`).
3. `run-painel-funcional-local.js` — runner Playwright com env correto.
4. `docs/AUTH-HOMOLOGACAO-PAINEL.md` — este documento.

Nenhuma mudança em arquitetura auth, provider ou infraestrutura.
