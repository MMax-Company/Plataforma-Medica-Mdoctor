# Painel Médico — Tour Visual E2E (Playwright real)

> 2026-06-02T02:45:38.362Z
> Navegador: Playwright Chromium headless
> Painel: https://painel-medico-staging-staging.up.railway.app
> Backend: https://mdoctor-backend-staging-staging.up.railway.app
> Login testado: `drmax.matos`

## Resumo

| Item | Resultado |
|------|-----------|
| Login UI real | ✅ OK |
| POST /api/auth/login | 200 |
| Token localStorage | ✅ |
| Redirect | https://painel-medico-staging-staging.up.railway.app/fila |
| Telas tour | 4 |
| Console errors | 35 |

## Login (JSON)

```json
{
  "ok": true,
  "steps": [
    {
      "step": "goto_login",
      "url": "https://painel-medico-staging-staging.up.railway.app/login"
    },
    {
      "step": "filled_credentials",
      "user": "drmax.matos",
      "password_length": 8,
      "password_preview": "Gr***"
    },
    {
      "step": "clicked_submit_button"
    },
    {
      "step": "login_request",
      "ok": true,
      "url": "https://painel-medico-staging-staging.up.railway.app/api/auth/login",
      "method": "POST",
      "status": 200,
      "requestBody": {
        "user": "drmax.matos",
        "password": "***"
      },
      "responseBody": {
        "success": true,
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkcl9tYXhfdmluaWNpdXNfMDAxIiwidXNlcm5hbWUiOiJkcm1heC5tYXRvcyIsInJvbGUiOiJhZG1pbiIsIm5hbWUiOiJEciBNYXggTWF0b3MiLCJpYXQiOjE3ODAzNjgzNDYsImV4cCI6MTc4MDM5NzE0Nn0.drYG8oc8ig53Sp2x4duAXEoxmFeU0cnSydeQ_h3FKwA",
        "user": {
          "id": "dr_max_vinicius_001",
          "name": "Dr Max Matos",
          "username": "drmax.matos",
          "role": "admin"
        }
      }
    }
  ],
  "token_saved": true,
  "redirect_url": "https://painel-medico-staging-staging.up.railway.app/fila",
  "redirect_ok": true
}
```

## Console errors

- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/observability?_=1780368367131' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368369506' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Failed to load resource: the server responded with a status of 422 ()`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368372459' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `{message: exceção [mdhub][plataforma.usuario](getUsuario), fields: Object}`
- `Failed to load resource: the server responded with a status of 401 ()`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/protocolos?_=1780368374293' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368374295' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/medicos-configuracoes/list_of_prescription_item_with_continuous_use?_=1780368375297' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368375301' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368376429' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368378216' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368379589' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368380952' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368382913' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368383934' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `undefined`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368384518' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780368385021' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.`
- `Failed to load resource: net::ERR_FAILED`
- `Memetrics não pode ser inicializado devido erro ao recuperar o token.`

## Screenshots reais

- [01-login-inicial.png](docs/screenshots/painel-tour/01-login-inicial.png) — `https://painel-medico-staging-staging.up.railway.app/login`
- [02-login-sucesso.png](docs/screenshots/painel-tour/02-login-sucesso.png) — `https://painel-medico-staging-staging.up.railway.app/fila`
- [03-fila.png](docs/screenshots/painel-tour/03-fila.png) — `https://painel-medico-staging-staging.up.railway.app/fila`
- [04-atendimento-157cef2c.png](docs/screenshots/painel-tour/04-atendimento-157cef2c.png) — `https://painel-medico-staging-staging.up.railway.app/atendimento/157cef2c-1f32-41c6-bfe9-99ce1581c1cb`
- [05-prontuario-157cef2c.png](docs/screenshots/painel-tour/05-prontuario-157cef2c.png) — `https://painel-medico-staging-staging.up.railway.app/prontuario/157cef2c-1f32-41c6-bfe9-99ce1581c1cb`
- [06-receita-157cef2c.png](docs/screenshots/painel-tour/06-receita-157cef2c.png) — `https://painel-medico-staging-staging.up.railway.app/receita?atendimentoId=157cef2c-1f32-41c6-bfe9-99ce1581c1cb`

Logs: [network-log.json](screenshots/painel-tour/network-log.json) · [console-log.json](screenshots/painel-tour/console-log.json)
