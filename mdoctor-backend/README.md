# Mdoctor Backend

Backend principal do Mdoctor Survive. Ele concentra as regras clinicas, elegibilidade, prontuario, Memed, entrega de receita, autenticacao JWT, painel admin e integracoes de producao.

## Rotas principais

- `GET /health` e `GET /healthz`: saude simples.
- `GET /readyz`: checagem de prontidao de producao.
- `POST /api/auth/login`: login do painel.
- `GET /api/admin/status`: status operacional protegido por JWT admin.
- `GET/PATCH /api/atendimentos`: fila, prontuario, status e entrega.
- `POST /api/whatsapp/webhook`: entrada de triagem via WhatsApp.
- `GET/POST /api/memed`: configuracao, token e registro de receita.

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
