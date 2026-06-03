# n8n — ingest da receita anterior (staging)

O upload usa **service role apenas no backend**. O n8n orquestra chamando o endpoint seguro abaixo (download + validação + Storage no Supabase atual).

## Node HTTP Request (opcional, entre *Build Payload* e *POST Backend*)

- **Method:** POST  
- **URL:** `{{ ($env.BACKEND_URL_STAGING || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '') + '/api/whatsapp/ingest-previous-prescription' }}`  
- **Headers:**
  - `Content-Type: application/json`
  - `X-MDoctor-Webhook-Secret: {{ $env.N8N_WEBHOOK_SECRET }}`
  - `X-Correlation-Id: {{ $('Build Payload').item.json.correlationId }}`
- **Body (JSON):**

```json
{
  "fileUrl": "={{ $('Build Payload').item.json.clean.previous_prescription_file }}",
  "atendimento_id": "={{ $('Build Payload').item.json.atendimentoId }}",
  "source": "typebot/n8n"
}
```

## Code node *Merge ingest* (após HTTP)

```javascript
const ctx = $('Build Payload').first().json;
const ingest = $input.first().json || {};
if (!ingest.success) {
  throw new Error(ingest.message || ingest.error || 'Falha no ingest da receita anterior');
}
const original = {
  ...ctx.payload.rawMessage.original,
  atendimento_id: ingest.atendimento_id || ctx.atendimentoId,
  previous_prescription_file: ingest.previous_prescription_url,
  previous_prescription_url: ingest.previous_prescription_url,
  previous_prescription_storage_path: ingest.previous_prescription_storage_path,
  previous_prescription_mime_type: ingest.previous_prescription_mime_type,
  previous_prescription_size: ingest.previous_prescription_size,
  previous_prescription_uploaded_at: ingest.previous_prescription_uploaded_at,
  previous_prescription_source: ingest.previous_prescription_source || 'typebot/n8n',
  foto_receita_url: ingest.foto_receita_url || ingest.previous_prescription_url
};
return [{
  json: {
    ...ctx,
    payload: {
      ...ctx.payload,
      rawMessage: { ...ctx.payload.rawMessage, original }
    }
  }
}];
```

No *Build Payload*, gerar `atendimentoId` (UUID) e incluir em `clean` / `payload.rawMessage.original` para o path `atendimentos/{id}/...` bater com o registro criado no webhook.

**Nota:** Se este node não existir, o backend ainda faz o ingest automaticamente no `POST /api/whatsapp/webhook`.
