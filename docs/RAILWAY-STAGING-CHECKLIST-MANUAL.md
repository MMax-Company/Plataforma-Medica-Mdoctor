# Railway Staging Checklist Manual

Checklist manual para criar staging do Doctor Prescreve sem alterar producao.

## Antes de comecar

- Confirmar repositorio: `MMax-Company/Plataforma-Medica-Mdoctor`.
- Confirmar branch: `codex/legacy-compat-infra`.
- Confirmar ambiente Railway: `staging`, nao `production`.
- Nao alterar dominio oficial.
- Nao alterar servicos de producao.
- Nao colar `.env` real em docs ou Git.
- Nao colocar `SUPABASE_SERVICE_ROLE_KEY` no painel.

## Backend-MDoctor-Staging

1. Criar servico Railway `Backend-MDoctor-Staging`.
2. Conectar ao repositorio `MMax-Company/Plataforma-Medica-Mdoctor`.
3. Selecionar branch `codex/legacy-compat-infra`.
4. Configurar root directory:

```text
mdoctor-backend
```

5. Confirmar Dockerfile esperado:

```text
mdoctor-backend/Dockerfile
```

6. Confirmar comandos:

```text
Build: npm install
Start: npm start
Healthcheck: /health
```

7. Configurar variaveis minimas:

```env
NODE_ENV=staging
ENVIRONMENT_NAME=staging
DATA_ENV=staging
PORT=3004
BASE_URL=https://URL_DO_BACKEND_STAGING
CORS_ORIGIN=https://URL_DO_PAINEL_STAGING
JWT_SECRET_DEVE_SER_DEFINIDO_NO_RAILWAY=staging-secret-forte
MEDICO_USER=<usuario-staging>
MEDICO_PASS=<senha-staging>
DISABLE_LOCAL_DB_FALLBACK=false
MEMED_ENABLED=false
MEMED_ENV=development
MEMED_API_URL=https://memed-staging.example.invalid/v1
MEMED_API_KEY=
MEMED_SECRET_KEY=
WHATSAPP_ENABLED=false
DELIVERY_MOCK_ENABLED=true
LEGACY_COMPAT_ENABLED=true
LEGACY_COMPAT_STRIPE=false
LEGACY_COMPAT_TYPEBOT=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
TYPEBOT_WEBHOOK_SECRET=
```

8. Se usar Supabase staging real, adicionar:

```env
SUPABASE_URL=https://SEU_SUPABASE_STAGING.supabase.co
SUPABASE_ANON_KEY=<anon-staging>
SUPABASE_SERVICE_ROLE_KEY_DEVE_SER_DEFINIDA_SOMENTE_NO_BACKEND=service-role-staging
SUPABASE_BUCKET_DOCUMENTS=documents
SUPABASE_BUCKET_PRESCRIPTIONS=prescriptions
SUPABASE_BUCKET_MEDICAL_RECORDS=medical-records
SUPABASE_BUCKET_CONSENTS=consents
SUPABASE_BUCKET_LOGS=logs
```

9. Deployar backend staging.
10. Gerar URL Railway do backend staging.
11. Testar:

```text
GET https://URL_DO_BACKEND_STAGING/health
GET https://URL_DO_BACKEND_STAGING/readyz
POST https://URL_DO_BACKEND_STAGING/api/auth/login
GET https://URL_DO_BACKEND_STAGING/api/atendimentos
```

12. Validar logs do backend staging.

## Painel-MDoctor-Staging

1. Criar servico Railway `Painel-MDoctor-Staging`.
2. Conectar ao repositorio `MMax-Company/Plataforma-Medica-Mdoctor`.
3. Selecionar branch `codex/legacy-compat-infra`.
4. Configurar root directory:

```text
mdoctor-panel
```

5. Confirmar Dockerfile esperado:

```text
mdoctor-panel/Dockerfile
```

6. Confirmar comandos:

```text
Build: Dockerfile / npm run build
Start: npm start
Healthcheck: /login
```

7. Configurar variaveis:

```env
NEXT_PUBLIC_API_URL=https://URL_DO_BACKEND_STAGING
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true
```

8. Deployar painel staging.
9. Gerar URL Railway do painel staging.
10. Testar:

```text
GET https://URL_DO_PAINEL_STAGING/login
GET https://URL_DO_PAINEL_STAGING/dashboard
```

11. Entrar com credenciais staging.
12. Validar fluxo mock:

- Login.
- Dashboard.
- Atender paciente.
- Abrir prontuario.
- Aprovar.
- Abrir Memed mock.
- Aceitar receita.
- Enviar WhatsApp mock.

## Ajuste CORS

Depois que a URL do painel staging existir:

1. Atualizar `CORS_ORIGIN` no `Backend-MDoctor-Staging` com `https://URL_DO_PAINEL_STAGING`.
2. Redeployar apenas o backend staging, se necessario.
3. Testar login pelo painel staging.

## Supabase staging

Antes de staging real com persistencia:

1. Aplicar `mdoctor-backend/supabase/migrations/20260527_backend_mvp_storage.sql`.
2. Criar/validar buckets:
   - `documents`
   - `prescriptions`
   - `medical-records`
   - `consents`
   - `logs`
3. Configurar `SUPABASE_SERVICE_ROLE_KEY` apenas no backend.
4. Nunca configurar service role no painel.

## Checklist final

- Backend staging `/health` retorna 200.
- Backend staging `/readyz` retorna JSON com storage/supabase/memed/fallback.
- Painel staging `/login` carrega.
- Painel staging usa `NEXT_PUBLIC_API_URL` do backend staging.
- Fluxo mock funciona.
- Logs sem erro critico.
- Nenhum dominio de producao foi alterado.
- Nenhum webhook real de Stripe, Typebot, Memed ou WhatsApp aponta para staging.
- Producao permanece intocada.
