# Autenticação Oficial — Painel Médico

Autenticação **única** via backend staging. Sem mock, sem sessão local fictícia.

---

## Endpoint

```http
POST https://mdoctor-backend-staging-staging.up.railway.app/api/auth/login
Content-Type: application/json

{
  "user": "drmax.matos",
  "username": "drmax.matos",
  "password": "<MEDICO_PASS>"
}
```

Resposta sucesso (`200`):

```json
{
  "success": true,
  "token": "<JWT>",
  "user": {
    "id": "staging-doctor",
    "name": "Dr Max Matos",
    "username": "drmax.matos",
    "role": "admin"
  }
}
```

---

## Sessão no painel

| Item | Detalhe |
|------|---------|
| Storage | `localStorage.mdoctor_auth_token` + `mdoctor_auth_user` |
| Validade JWT | 8 horas (`expiresIn` backend) |
| Validação | `GET /api/auth/me` com `Authorization: Bearer` |
| Logout | `clearSession()` → redirect `/login` |
| Pós-login | redirect `/fila` |

---

## Médico operador oficial

| Campo | Valor |
|-------|--------|
| Login | `drmax.matos` |
| Senha | Railway `MEDICO_PASS` (backend staging) |
| Papel | `admin` |

**Nunca** commitar senha no Git. Rotacionar via Railway Variables.

---

## CORS

Backend deve permitir origem:

```txt
https://painel-medico-staging-staging.up.railway.app
```

(`CORS_ORIGIN` no backend staging)

---

## Checklist auth

- [ ] `POST /api/auth/login` → 200 + token
- [ ] `GET /api/auth/me` → 200 + user
- [ ] Login painel → `/fila` sem loop
- [ ] Logout → `/login` limpa token
- [ ] Sem `mdoctor_panel_mock_session` no storage

---

## Teste rápido (terminal)

```powershell
node -e "fetch('https://mdoctor-backend-staging-staging.up.railway.app/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:'drmax.matos',password:process.env.MEDICO_PASS})}).then(r=>r.json()).then(console.log)"
```

($env:MEDICO_PASS antes de executar)
