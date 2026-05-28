# Railway Staging Setup

Guia para preparar staging tecnico do Doctor Prescreve no Railway sem alterar producao.

## Escopo

Repositorio: `MMax-Company/Plataforma-Medica-Mdoctor`

Branch esperada: `codex/legacy-compat-infra`

Servicos de staging:

- `mdoctor-backend-staging`
- `painel-medico-staging`

Nao reutilizar servicos de producao. Nao migrar dominio customizado. Nao copiar variaveis sensiveis de producao sem revisao.

## Servico Backend

Servico Railway sugerido: `mdoctor-backend-staging`

Root directory:

```text
mdoctor-backend
```

Arquivos relevantes:

- `mdoctor-backend/package.json`
- `mdoctor-backend/Dockerfile`
- `mdoctor-backend/railway.json`

Scripts confirmados:

```json
{
  "start": "node server.js",
  "dev": "nodemon server.js",
  "check": "node --check ..."
}
```

Build/start:

- `railway.json` usa Nixpacks.
- Build command: `npm install`.
- Start command: `npm start`.
- Dockerfile tambem esta pronto para container Node 20 com `CMD ["npm", "start"]`.

Healthcheck:

```text
/health
```

Observacao: `/readyz` deve ser usado para diagnostico operacional, mas `/health` e o healthcheck mais seguro para deploy inicial porque staging pode rodar com Supabase/Memed/WhatsApp em mock/fallback.

Variaveis staging do backend:

```env
NODE_ENV=staging
ENVIRONMENT_NAME=staging
DATA_ENV=staging
PORT=3004
BASE_URL=https://<backend-staging>.up.railway.app
CORS_ORIGIN=https://<painel-staging>.up.railway.app
LOG_LEVEL=info
DISABLE_LOCAL_DB_FALLBACK=false

JWT_SECRET=<staging-secret-forte>
MEDICO_USER=<usuario-staging>
MEDICO_PASS=<senha-staging>
MEDICO_ROLE=admin
MEDICO_NOME=Medico Staging

SUPABASE_URL=<supabase-staging-url-ou-vazio>
SUPABASE_ANON_KEY=<supabase-staging-anon-ou-vazio>
SUPABASE_SERVICE_KEY=<supabase-staging-service-ou-vazio>
SUPABASE_SERVICE_ROLE_KEY=<supabase-staging-service-role-ou-vazio>
SUPABASE_BUCKET_DOCUMENTS=documents
SUPABASE_BUCKET_PRESCRIPTIONS=prescriptions
SUPABASE_BUCKET_MEDICAL_RECORDS=medical-records
SUPABASE_BUCKET_CONSENTS=consents
SUPABASE_BUCKET_LOGS=logs

MEMED_ENABLED=false
MEMED_ENVIRONMENT=development
MEMED_ENV=development
MEMED_API_URL=https://memed-staging.example.invalid/v1
MEMED_TIMEOUT_MS=8000
MEMED_API_KEY=
MEMED_SECRET_KEY=

WHATSAPP_ENABLED=false
DELIVERY_MOCK_ENABLED=true
ALLOW_PRODUCTION_DELIVERY_MOCK=false

LEGACY_COMPAT_ENABLED=true
LEGACY_COMPAT_WHATSAPP=true
LEGACY_COMPAT_PANEL=true
LEGACY_COMPAT_MEMED=true
LEGACY_COMPAT_STRIPE=false
LEGACY_COMPAT_TYPEBOT=false

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
TYPEBOT_WEBHOOK_SECRET=
```

Notas:

- Para staging sem Supabase real, deixar `DISABLE_LOCAL_DB_FALLBACK=false`.
- Para staging com Supabase real, aplicar migrations antes e configurar `SUPABASE_SERVICE_ROLE_KEY`.
- Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no painel.
- Stripe, Typebot, Memed real e WhatsApp real permanecem desligados nesta fase.

## Servico Painel

Servico Railway sugerido: `painel-medico-staging`

Root directory:

```text
mdoctor-panel
```

Arquivos relevantes:

- `mdoctor-panel/package.json`
- `mdoctor-panel/Dockerfile`
- `mdoctor-panel/railway.json`
- `mdoctor-panel/.dockerignore`

Scripts confirmados:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint ."
}
```

Build/start:

- Dockerfile usa Node 20.
- Instala com `npm ci`.
- Roda `npm run build`.
- Inicia com `npm start`.
- Aceita `ARG NEXT_PUBLIC_API_URL`.
- Aceita `ARG NEXT_PUBLIC_APP_ENV`.
- Aceita `ARG NEXT_PUBLIC_ENABLE_MOCK_FALLBACK`.

Healthcheck:

```text
/login
```

Variaveis staging do painel:

```env
NEXT_PUBLIC_API_URL=https://<backend-staging>.up.railway.app
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true
```

Notas:

- `NEXT_PUBLIC_API_URL` precisa estar disponivel no build do Next.
- O painel nao deve receber segredos.
- O painel nao deve receber `SUPABASE_SERVICE_ROLE_KEY`.
- O fallback mock pode ficar ligado em staging tecnico para evitar tela quebrada quando Memed/WhatsApp ainda estiverem mockados.

## Ordem de deploy

1. Confirmar que a branch `codex/legacy-compat-infra` esta atualizada no GitHub.
2. Criar ambiente Railway `staging`, separado de `production`.
3. Criar servico `mdoctor-backend-staging` com root `mdoctor-backend`.
4. Configurar variaveis seguras do backend staging.
5. Deployar backend staging.
6. Gerar dominio Railway do backend staging.
7. Validar backend:

```text
GET https://<backend-staging>.up.railway.app/health
GET https://<backend-staging>.up.railway.app/readyz
POST https://<backend-staging>.up.railway.app/api/auth/login
GET https://<backend-staging>.up.railway.app/api/atendimentos
```

8. Criar servico `painel-medico-staging` com root `mdoctor-panel`.
9. Configurar `NEXT_PUBLIC_API_URL` do painel apontando para a URL do backend staging.
10. Deployar painel staging.
11. Gerar dominio Railway do painel staging.
12. Atualizar `CORS_ORIGIN` do backend staging com a URL do painel staging.
13. Redeployar backend staging se necessario.
14. Validar painel:

```text
GET https://<painel-staging>.up.railway.app/login
GET https://<painel-staging>.up.railway.app/dashboard
```

## Como validar URLs staging

Backend:

```text
/health deve retornar 200.
/readyz deve retornar JSON com auth, storage, supabase, memed, fallback_local e environment.
```

Painel:

```text
/login deve carregar.
Login staging deve redirecionar para /dashboard.
Dashboard deve consumir o backend staging via NEXT_PUBLIC_API_URL.
```

Validacoes funcionais minimas:

- Login JWT.
- `GET /api/auth/me`.
- `GET /api/atendimentos`.
- `GET /api/atendimentos/:id`.
- `PATCH /api/atendimentos/:id/status`.
- `GET /api/prescriptions/:id`.
- `POST /api/prescriptions/:id/generate`.
- `POST /api/atendimentos/:id/deliver`.

## Como evitar mexer em producao

Checklist obrigatorio antes de qualquer acao Railway:

- Confirmar projeto correto.
- Confirmar ambiente `staging`, nao `production`.
- Confirmar servico staging, nao servico de producao.
- Nao copiar dominios customizados de producao.
- Nao alterar variables de production.
- Nao habilitar Stripe real.
- Nao habilitar WhatsApp real.
- Nao habilitar Memed production.
- Nao apontar Typebot/Stripe/Memed webhooks de producao para staging.
- Usar dominios `.up.railway.app` gerados para staging tecnico.

## Checklist antes de deploy

- Branch correta enviada para GitHub.
- Working tree local limpo.
- `npm --prefix mdoctor-backend run check` passou.
- `npm --prefix mdoctor-panel run build` passou.
- `npm --prefix mdoctor-panel run lint` passou ou apenas warnings conhecidos.
- `.env` reais nao foram commitados.
- Painel tem `NEXT_PUBLIC_API_URL` configuravel.
- Backend tem `/health` e `/readyz`.
- Supabase real e opcional; fallback local permitido no staging tecnico.
- Memed real desligada.
- WhatsApp real desligado.
- Stripe/Typebot desligados.

## Variaveis minimas por servico

Backend staging minimo para smoke test:

```env
NODE_ENV=staging
ENVIRONMENT_NAME=staging
DATA_ENV=staging
PORT=3004
BASE_URL=https://<backend-staging>.up.railway.app
CORS_ORIGIN=https://<painel-staging>.up.railway.app
JWT_SECRET=<staging-secret-forte>
MEDICO_USER=<usuario-staging>
MEDICO_PASS=<senha-staging>
DISABLE_LOCAL_DB_FALLBACK=false
MEMED_ENABLED=false
WHATSAPP_ENABLED=false
DELIVERY_MOCK_ENABLED=true
LEGACY_COMPAT_ENABLED=true
LEGACY_COMPAT_STRIPE=false
LEGACY_COMPAT_TYPEBOT=false
```

Painel staging minimo:

```env
NEXT_PUBLIC_API_URL=https://<backend-staging>.up.railway.app
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true
```
