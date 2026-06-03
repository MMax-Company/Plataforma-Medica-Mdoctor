# Auth Tour Técnico — Doctor Prescreve

> 2026-06-03T09:27:42.275Z
> Backend: https://mdoctor-backend-staging-staging.up.railway.app
> Painel: https://painel-medico-staging-staging.up.railway.app
> Usuário testado: `drmax.matos`

## Conclusão

**Autenticação/autorização apta para piloto fechado** — login único operacional; APIs protegidas; legado bloqueado.

## Checklist executado

| # | Teste | Resultado |
|---|-------|-----------|
| 1_login_page | Tela /login acessível | ✅ 200 |
| 2_senha_errada | Senha errada bloqueada | ✅ 401 |
| 3_admin_legacy | admin/admin123 bloqueado | ✅ 401 |
| 4_login_correto_backend | Login drmax.matos backend | ✅ 200 |
| 4b_login_proxy | Login via proxy painel /api/auth/login | ✅ 200 |
| 5_jwt_valido | JWT estrutura válida (username, exp, role) | ✅  |
| 6_me_backend | GET /api/auth/me backend | ✅ 200 |
| 6b_me_proxy | GET /api/auth/me via proxy painel | ✅ 200 |
| 5b_refresh | POST /api/auth/refresh renova JWT | ✅ 200 |
| 5c_me_after_refresh | GET /api/auth/me após refresh | ✅ 200 |
| 7_fila_api | Fila médica API com token | ✅ 200 |
| 7b_fila_page | Página /fila carrega (guard client-side) | ✅ 200 |
| 8_atendimento_protegido | Atendimento GET com token | ✅ 200 |
| 9_prontuario_page | Página /prontuario/[id] carrega | ✅ 200 |
| 10_approve_sem_token | Approve sem token → 401 | ✅ 401 |
| 11_approve_com_token | Approve com token autentica (não 401) | ✅ 409 |
| 13_api_sem_token | API fila sem token → 401 | ✅ 401 |
| 13b_me_sem_token | /api/auth/me sem token → 401 | ✅ 401 |
| 13c_token_invalido | Token inválido → 401 | ✅ 401 |
| role_admin | Role admin acessa /api/admin/status | ✅ 200 |
| 14_sem_mock_auth | Sem bypass auth por mock session no backend | ✅ Login só via MEDICO_USER/MEDICO_PASS |
| 12_logout | Logout limpa localStorage e bloqueia API | ✅  |

## Respostas objetivas

- **Login correto funciona:** sim
- **Senhas inválidas bloqueiam:** sim
- **admin/admin123 bloqueado:** sim
- **JWT válido:** sim
- **/api/auth/me funciona:** sim
- **Rotas API bloqueiam sem token:** sim
- **Rotas API liberam com token:** sim
- **Approve sem token bloqueado:** sim
- **Approve com token autentica:** sim
- **Sessão persiste (localStorage):** sim
- **Logout limpa sessão:** sim
- **Risco bloqueio indevido médico:** baixo
- **Risco acesso indevido mock/fallback:** baixo

## Auditoria estática (código)

- ✅ .env.example painel: mock fallback false por padrão
- ✅ auth.routes.js sem fallback admin/admin123
- ✅ middleware JWT exige Bearer e retorna códigos AUTH_*
- ✅ proxy /api/* configurado em next.config.mjs
- ✅ sem middleware.ts Next — rotas UI protegidas no client (useRequireAuth/requireSession) — *HTML de /fila e /atendimento retorna 200; bloqueio é client-side + API 401*
- ✅ auth.service limpa mdoctor_panel_mock_session no login/save/clear
- ✅ isMockFallbackEnabled só true se env explícita

## Variáveis de ambiente

### mdoctor-panel/.env.local
- Existe local: sim
- Chaves locais: API_PROXY_TARGET, NEXT_PUBLIC_API_BASE_URL, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_APP_ENV, NEXT_PUBLIC_MEMED_REAL_ENABLED, NEXT_PUBLIC_STAGING_BUILD_MARKER, NEXT_PUBLIC_ENABLE_MOCK_FALLBACK
- Esperado Railway: NEXT_PUBLIC_API_URL; NEXT_PUBLIC_ENABLE_MOCK_FALLBACK

### mdoctor-backend/.env.local
- Existe local: sim
- Chaves locais: NODE_ENV, ENVIRONMENT_NAME, DATA_ENV, PORT, BASE_URL, NEXT_PUBLIC_API_URL, CORS_ORIGIN, LOG_LEVEL, DISABLE_LOCAL_DB_FALLBACK, LEGACY_COMPAT_ENABLED, LEGACY_COMPAT_WHATSAPP, LEGACY_COMPAT_PANEL, LEGACY_COMPAT_MEMED, LEGACY_COMPAT_STRIPE, LEGACY_COMPAT_TYPEBOT, JWT_SECRET, MEDICO_USER, MEDICO_PASS, MEDICO_ROLE, MEDICO_NOME, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_SERVICE_ROLE_KEY, MEMED_ENABLED, MEMED_ENVIRONMENT, MEMED_ENV, MEMED_API_KEY, MEMED_SECRET_KEY, MEMED_API_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_ENABLED, TYPEBOT_WEBHOOK_SECRET, TYPEBOT_ENABLED, WHATSAPP_ENABLED, DELIVERY_MOCK_ENABLED, ALLOW_PRODUCTION_DELIVERY_MOCK
- Esperado Railway: JWT_SECRET; MEDICO_USER; MEDICO_PASS; MEDICO_ROLE; CORS_ORIGIN

### Railway painel (script apply-painel-definitivo)
- Esperado Railway: NEXT_PUBLIC_API_URL; API_PROXY_TARGET; NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false; NEXT_PUBLIC_APP_ENV=staging

### Railway backend (script apply-painel-definitivo)
- Esperado Railway: MEDICO_USER=drmax.matos; MEDICO_PASS; MEDICO_ROLE=admin; MEDICO_EXTERNAL_ID; JWT_SECRET; CORS_ORIGIN=painel URL

## Riscos

- ui_shallow — HTML de /fila e /atendimento retorna 200; bloqueio é client-side + API 401