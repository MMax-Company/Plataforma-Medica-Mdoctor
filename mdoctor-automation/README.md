# Mdoctor Automation

Servico de automacao do Mdoctor Survive. Ele recebe webhooks externos, valida a origem, normaliza payloads e encaminha a regra de negocio para o `mdoctor-backend`, mantendo o backend como fonte oficial do spec.

## Rotas

- `GET /health` e `GET /healthz`: saude simples do servico.
- `GET /readyz`: prontidao de producao, incluindo `BACKEND_URL`, secret de webhook e saude do backend.
- `GET /metrics`: contadores internos. Protegido por `AUTOMATION_WEBHOOK_SECRET` quando configurado.
- `POST /webhook/whatsapp`: recebe `{ from, text }` ou formatos comuns de provedores como Twilio e encaminha para `/api/whatsapp/webhook`.
- `POST /webhook/decisao`: recebe eventos de decisao/aprovacao. Se `DECISION_WEBHOOK_FORWARD_URL` estiver vazio, aceita o evento sem reencaminhar.
- `POST /webhook/test`: eco autenticado para teste rapido.

## Producao

Copie `.env.production.example` para o provedor de deploy e configure:

- `NODE_ENV=production`
- `BACKEND_URL=https://...`
- `AUTOMATION_WEBHOOK_SECRET` com segredo forte
- `REDIS_URL` somente se o worker de fila for usado

Nunca suba `.env`, logs, `node_modules` ou artefatos temporarios para o GitHub.

## Comandos

```bash
npm run check
npm start
npm run worker
npm run smoke
```
