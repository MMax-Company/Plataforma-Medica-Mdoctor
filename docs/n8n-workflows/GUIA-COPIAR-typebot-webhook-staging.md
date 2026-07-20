# Guia — workflow Typebot Webhook Staging

**URL n8n staging:** https://n8n-staging-staging-2dfe.up.railway.app  
**Webhook público oficial:** `POST /webhook/typebot-webhook`

> O arquivo `typebot-webhook-staging-COPIAR.json` está **desativado** (`active: false`).  
> Não importe o COPIAR. Use apenas `typebot-webhook-staging.json`.

---

## Importar JSON oficial

1. Abra o n8n staging.
2. **Import from File** → `docs/n8n-workflows/typebot-webhook-staging.json`
3. **Save** + toggle **Active**.

## Cadeia oficial

```
Webhook Typebot → Build Payload → POST Triagem Backend → Route Response → Backend OK? → Resposta
```

- Backend: `POST {BACKEND_BASE_URL}/api/webhook/triagem`
- Headers: `X-MDoctor-Webhook-Secret`, `X-Correlation-Id`, `Idempotency-Key`, `X-N8N-Workflow`

## Bloqueado

- `/api/whatsapp/webhook` (entrada Meta, não Typebot→n8n)
- `/api/whatsapp/support` e `/api/whatsapp/process-message` (410)
- Confirmação de pagamento no n8n
- Menus, Evolution, Baileys, `TYPEBOT_PUBLIC_URL`

Ver: `TYPEBOT-WEBHOOK-TRIAGEM.md`
