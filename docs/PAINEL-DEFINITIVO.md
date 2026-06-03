# Painel Médico Definitivo — Doctor Prescreve

Ambiente operacional web **único** para o médico operador (staging Railway).

---

## URLs oficiais

| Sistema | URL |
|---------|-----|
| **Painel (login)** | https://painel-medico-staging-staging.up.railway.app/login |
| **Backend API** | https://mdoctor-backend-staging-staging.up.railway.app |

**Não usar** `localhost`, `npm run dev` ou `dev:staging` na operação diária.

---

## Credenciais médico operador

| Campo | Valor |
|-------|--------|
| Usuário | `drmax.matos` |
| Senha | configurada em `MEDICO_PASS` (Railway backend staging) |

Login no campo **Usuário** (não é e-mail).

---

## Variáveis Railway — painel (`painel-medico-staging`)

```env
NEXT_PUBLIC_API_URL=https://mdoctor-backend-staging-staging.up.railway.app
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false
```

Importante: `NEXT_PUBLIC_*` é embutido no **build**. Após alterar, **redeploy obrigatório**.

---

## Variáveis Railway — backend (`mdoctor-backend-staging`)

```env
MEDICO_USER=drmax.matos
MEDICO_PASS=<senha oficial>
MEDICO_NOME=Dr Max Matos
MEDICO_ROLE=admin
CORS_ORIGIN=https://painel-medico-staging-staging.up.railway.app
```

---

## Fluxo operacional

```text
/login → /fila → /atendimento/[id] → /prontuario/[id]
  → approve → /receita?atendimentoId=... → validate → deliver
```

---

## Rotas validadas

| Rota | Função |
|------|--------|
| `/login` | Autenticação JWT |
| `/fila` | Fila médica |
| `/atendimento/[id]` | Decisão clínica |
| `/prontuario/[id]` | Prontuário |
| `/receita?atendimentoId=` | Widget Sinapse |
| `/dashboard` | Visão alternativa (legado) |

---

## O que foi removido do painel

- Proxy local `/api/*` (Next rewrites)
- Fallback `localhost:3004`
- Sessão mock (`mdoctor_panel_mock_session`)
- Login silencioso offline/mock

---

## Aplicar tudo no Railway (uma vez)

```powershell
railway login
cd mdoctor-panel
$env:MEDICO_PASS="Gr@tid@0"
node scripts/apply-painel-definitivo-railway.js
npm run validate:definitivo
```

Isso configura vars backend + painel e dispara redeploy de ambos.

---

## Validação automatizada

```powershell
cd mdoctor-panel
$env:MEDICO_USER="drmax.matos"
$env:MEDICO_PASS="<senha>"
node scripts/validate-painel-definitivo.js
```

---

## Troubleshooting

| Sintoma | Causa | Ação |
|---------|-------|------|
| 404 `Rota nao encontrada` no login | Painel chama a si mesmo | Confirmar `NEXT_PUBLIC_API_URL` + redeploy |
| Credenciais inválidas | `MEDICO_*` desatualizado | Atualizar vars backend + redeploy |
| Loop login/fila | Token inválido em localStorage | Limpar storage do site e relogar |
| Tela branca pós-login | API indisponível | `GET /health` no backend |
