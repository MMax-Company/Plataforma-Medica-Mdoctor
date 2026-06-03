# Painel Médico — Hardening Final

> Gerado em: 2026-06-02T02:45:38.362Z
> Painel: https://painel-medico-staging-staging.up.railway.app
> Backend: https://mdoctor-backend-staging-staging.up.railway.app

## Objetivo

Estabilização do fluxo médico: login → fila → atendimento → prontuário → approve/reject → Memed → persistência → validate → deliver.

## Checklist operacional

| Item | Status |
|------|--------|
| Login único (`drmax.matos`) | ✅ |
| JWT + redirect /fila | ✅ |
| Tour visual (4 telas) | ✅ |
| Console errors | ⚠️ 35 |

## Alterações aplicadas (código)

- Auth backend unificado: `MEDICO_USER` + `MEDICO_PASS` (sem alias/official fallback)
- Endpoints de leitura protegidos com JWT (`/queue`, `/:id`, etc.)
- Guards de sessão via `requireSession()` / `useRequireAuth()`
- Mock fallbacks desligados quando `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false`
- Dashboard legado redireciona para `/fila`
- Escala visual: base 14px, max-width 1280px, widget Memed responsivo

## Screenshots

- [01-login-inicial.png](docs/screenshots/painel-tour/01-login-inicial.png)
- [02-login-sucesso.png](docs/screenshots/painel-tour/02-login-sucesso.png)
- [03-fila.png](docs/screenshots/painel-tour/03-fila.png)
- [04-atendimento-157cef2c.png](docs/screenshots/painel-tour/04-atendimento-157cef2c.png)
- [05-prontuario-157cef2c.png](docs/screenshots/painel-tour/05-prontuario-157cef2c.png)
- [06-receita-157cef2c.png](docs/screenshots/painel-tour/06-receita-157cef2c.png)

Detalhes: [PAINEL-TOUR-VISUAL-RELATORIO.md](PAINEL-TOUR-VISUAL-RELATORIO.md)
