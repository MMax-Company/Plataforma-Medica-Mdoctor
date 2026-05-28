# Mdoctor Backend

Backend principal do Mdoctor Survive. Ele concentra as regras clinicas, elegibilidade, prontuario, Memed, entrega de receita, autenticacao JWT, painel admin e integracoes de producao.

## Como rodar local

```bash
npm --prefix mdoctor-backend install
npm --prefix mdoctor-backend run dev
```

O backend local usa a porta `3004` por padrao:

```text
http://localhost:3004
```

Crie o ambiente local a partir de `.env.local.example` ou `.env.example`. Variaveis minimas:

```env
PORT=3004
JWT_SECRET=
MEDICO_USER=admin
MEDICO_PASS=change-me-local
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
DELIVERY_MOCK_ENABLED=true
MEMED_ENABLED=false
WHATSAPP_ENABLED=false
```

## Rotas principais

- `GET /health` e `GET /healthz`: saude simples.
- `GET /readyz`: checagem de prontidao de producao.
- `POST /api/auth/login`: login do painel.
- `GET /api/auth/me`: sessao JWT atual.
- `GET /api/admin/status`: status operacional protegido por JWT admin.
- `GET /api/atendimentos`: lista de atendimentos normalizados para o painel.
- `GET /api/atendimentos/:id`: detalhe do atendimento/prontuario.
- `PATCH /api/atendimentos/:id/status`: atualizacao de status protegida por JWT.
- `GET /api/prescriptions/:id`: receita Memed ou mock seguro.
- `POST /api/prescriptions/:id/generate`: gera receita em modo Memed ou mock controlado.
- `POST /api/atendimentos/:id/deliver`: entrega mockada/real conforme ambiente.
- `POST /api/whatsapp/webhook`: entrada de triagem via WhatsApp.
- `GET/POST /api/memed`: configuracao, token e registro de receita.

## Status do MVP

As respostas para o painel usam estes status canonicos:

```text
waiting -> em_atendimento -> memed_processing -> ready -> delivered
rejected
```

Status antigos como `QUEUE`, `FILA`, `UNDER_REVIEW`, `VALIDATED`, `RECEITA_EMITIDA` e equivalentes continuam aceitos na entrada e sao normalizados na resposta.

## Auth JWT

O login local usa `POST /api/auth/login` com `MEDICO_USER` e `MEDICO_PASS`. O token retornado deve ser enviado como:

```text
Authorization: Bearer <token>
```

Rotas protegidas retornam `401` em JSON padronizado quando o token estiver ausente, invalido ou expirado.

## Memed e WhatsApp no MVP

Memed real ainda nao e obrigatoria nesta fase. Quando a integracao estiver indisponivel, `GET /api/prescriptions/:id` e `POST /api/prescriptions/:id/generate` retornam payload mockado consistente para nao quebrar o painel.

Variaveis Memed:

```env
MEMED_API_URL=https://integrations.api.memed.com.br/v1
MEMED_API_KEY=
MEMED_SECRET_KEY=
MEMED_ENV=development
MEMED_TIMEOUT_MS=8000
```

Sem credenciais, o backend usa `source: "mock"`. Com credenciais validas, usa `source: "memed"`.

WhatsApp real tambem nao e chamado diretamente no MVP local. Com `DELIVERY_MOCK_ENABLED=true`, a entrega marca o atendimento como `delivered` usando registro mockado.

## Supabase MVP

O backend usa Supabase quando estas variaveis estiverem configuradas:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET_DOCUMENTS=documents
SUPABASE_BUCKET_PRESCRIPTIONS=prescriptions
SUPABASE_BUCKET_MEDICAL_RECORDS=medical-records
SUPABASE_BUCKET_CONSENTS=consents
SUPABASE_BUCKET_LOGS=logs
```

O `SUPABASE_SERVICE_ROLE_KEY` deve existir somente no backend. Nunca use essa chave no painel ou em variaveis `NEXT_PUBLIC_*`.

Migration MVP:

```text
mdoctor-backend/supabase/migrations/20260527_backend_mvp_storage.sql
```

Ela cria as tabelas `patients`, `atendimentos`, `prescriptions` e `audit_logs`, habilita RLS e cria policies para `service_role`.

Se Supabase nao estiver configurado ou falhar em ambiente com fallback permitido, o backend usa `fallback_local` e preserva o painel funcionando. O status aparece em `GET /readyz` nos campos `storage`, `supabase`, `memed`, `auth`, `environment` e `fallback_local`.

Mais detalhes em `SUPABASE_SETUP.md`.

## Producao

Configure as variaveis do `.env.production.example` no provedor de deploy:

- `NODE_ENV=production`
- `BASE_URL`
- `CORS_ORIGIN`
- `JWT_SECRET` com pelo menos 32 caracteres
- `MEDICO_USER`, `MEDICO_PASS`, `MEDICO_ROLE=admin`
- `SUPABASE_URL` e service key
- Credenciais Memed reais
- Pelo menos um provider de entrega: Twilio WhatsApp/SMS ou Resend e-mail

O servidor bloqueia inicializacao em producao se configuracoes criticas estiverem ausentes.

## Hardening atual

- Headers de seguranca via Helmet.
- CORS restrito por `CORS_ORIGIN`.
- Rate limit global, login e webhook.
- Logs estruturados em JSON.
- Fallback local de dados bloqueado em producao.
- `readyz` para deploy e operacao.
- Respostas de erro sem stack trace em producao.

## Comandos

```bash
npm run check
npm start
npm run dev
```

Nunca envie `.env`, logs, `node_modules`, `.next`, `whatsapp_auth` ou bancos locais para o GitHub.
