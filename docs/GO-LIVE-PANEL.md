# Go-Live — Painel Médico (Staging Operacional)

Checklist para colocar o painel em operação web definitiva.

---

## Pré-requisitos

- [ ] Backend staging online: `GET /health` → 200
- [ ] `MEDICO_USER=drmax.matos` no backend staging
- [ ] `MEDICO_PASS` configurado no Railway (backend)
- [ ] `NEXT_PUBLIC_API_URL` apontando ao backend staging (painel)
- [ ] CORS inclui URL do painel

---

## Deploy painel

1. Confirmar branch/repo no serviço `painel-medico-staging` (Painel-MDoctor)
2. Variáveis Railway (painel):

```env
NEXT_PUBLIC_API_URL=https://mdoctor-backend-staging-staging.up.railway.app
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false
```

3. Redeploy (build Next.js com envs acima)
4. Aguardar status **SUCCESS**

---

## Validação pós-deploy

### 1. Páginas públicas

| URL | Esperado |
|-----|----------|
| `/login` | 200, formulário visível |
| `/` | redirect `/login` |

### 2. Auth

```powershell
cd mdoctor-panel
$env:MEDICO_USER="drmax.matos"
$env:MEDICO_PASS="<senha>"
node scripts/validate-painel-definitivo.js
```

### 3. Manual (médico)

1. Abrir https://painel-medico-staging-staging.up.railway.app/login
2. Login `drmax.matos`
3. Confirmar `/fila` carrega atendimentos
4. Abrir um atendimento → prontuário → fluxo clínico

### 4. Fluxo clínico completo

```text
login → fila → atendimento → prontuário → approve
  → receita (Sinapse) → validate → deliver
```

---

## Critério go-live painel

- [ ] Login único `drmax.matos` funciona na URL Railway
- [ ] Sem dependência de localhost/terminal
- [ ] JWT persiste entre refresh
- [ ] Logout funcional
- [ ] Rotas `/fila`, `/atendimento`, `/prontuario`, `/receita` acessíveis
- [ ] Documentação `PAINEL-DEFINITIVO.md` + `AUTH-OFICIAL.md` atualizada

---

## Rollback

1. Railway → painel-medico-staging → Deployments → redeploy anterior
2. Se auth quebrar: restaurar `MEDICO_USER`/`MEDICO_PASS` anteriores no backend

---

## Fora de escopo deste go-live

- n8n, Typebot, Stripe, WhatsApp produção
- Backend `web` produção
- Múltiplos médicos
