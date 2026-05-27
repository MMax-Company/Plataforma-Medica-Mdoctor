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
JWT_SECRET=dev_secret_change_me
MEDICO_USER=admin
MEDICO_PASS=admin123
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

Memed real ainda nao e obrigatoria nesta fase. Quando a integracao estiver indisponivel, `GET /api/prescriptions/:id` retorna uma receita mockada consistente para nao quebrar o painel.

WhatsApp real tambem nao e chamado diretamente no MVP local. Com `DELIVERY_MOCK_ENABLED=true`, a entrega marca o atendimento como `delivered` usando registro mockado.

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
