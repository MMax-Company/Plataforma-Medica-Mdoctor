# Hardening UX — Teste Humano Memed

> 2026-06-02T03:30:22.606Z

| Campo | Valor |
|-------|-------|
| URL painel | https://painel-medico-staging-staging.up.railway.app |
| URL backend | https://mdoctor-backend-staging-staging.up.railway.app |
| atendimentoId | b72b22df-8f88-4e1c-b42f-0532842c04e8 |
| login | OK |
| painel | OK |
| Memed | ERRO |
| botões | OK |

## Erros encontrados
- Console: Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/observability?_=1780370961999' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.

## Correções feitas
- useMemedSinapse.ts + MemedPrescriptionWorkspace.tsx — lock isOpening anti duplo clique

## Status final

**HUMAN MEMED TEST READY:** NO

### Console bloqueante
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/observability?_=1780370961999' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to prefli
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370964960' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370968385' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/protocolos?_=1780370970554' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370970562' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/medicos-configuracoes/list_of_prescription_item_with_continuous_use?_=1780370971552' from origin 'https://integrations.memed.com.b
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370971554' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Failed to load resource: the server responded with a status of 401 ()
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370972702' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Failed to load resource: the server responded with a status of 422 ()
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370980219' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370982282' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370990148' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370993231' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370995297' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370996541' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780370997202' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780371005261' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780371008172' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Failed to load resource: the server responded with a status of 422 ()
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/protocolos?_=1780371008390' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780371008408' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Failed to load resource: the server responded with a status of 401 ()
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/usuarios?_=1780371009138' from origin 'https://integrations.memed.com.br' has been blocked by CORS policy: Response to preflight r
- Access to XMLHttpRequest at 'https://integrations.api.memed.com.br/v1/medicos-configuracoes/list_of_prescription_item_with_continuous_use?_=1780371009136' from origin 'https://integrations.memed.com.b