# Guia completo — refazer workflow `typebot-webhook-staging` no n8n

**URL n8n staging:** https://n8n-staging-staging-2dfe.up.railway.app  
**Webhook público:** `POST /webhook/typebot-webhook`

---

## Opção A (mais rápida): Importar JSON

1. Abra o workflow `Typebot Webhook - Staging` no n8n.
2. Menu **⋯** → **Import from File** (ou substitua o workflow).
3. Use o arquivo do repositório:  
   `docs/n8n-workflows/typebot-webhook-staging.json`
4. **Save** + toggle **Active**.

---

## Opção B: Montar manualmente (5 nodes)

### Cadeia obrigatória

```
Webhook Typebot → Build Payload → POST Backend → Wrap Response → Resposta Sucesso
```

**Apague** qualquer node antigo `Respond` desconectado.

---

### NODE 1 — Webhook Typebot

| Campo | Valor |
|-------|--------|
| HTTP Method | POST |
| Path | `typebot-webhook` |
| Respond | **Using 'Respond to Webhook' Node** |
| Response Data | (deixa o node **Resposta Sucesso** no fim da cadeia) |

---

### NODE 2 — Build Payload (Code)

Mode: **Run Once for All Items**

Cole **todo** o código abaixo:

```javascript
// (código completo — igual ao arquivo lib/typebot-webhook-payload.code.js)
```

> O código completo está em:  
> `docs/n8n-workflows/lib/typebot-webhook-payload.code.js`  
> (copie o arquivo inteiro para o node Code)

---

### NODE 3 — POST Backend (HTTP Request)

| Campo | Valor |
|-------|--------|
| Method | POST |
| URL | `={{ ($env.BACKEND_URL_STAGING || 'https://mdoctor-backend-staging-staging.up.railway.app').replace(/\/$/, '') + '/api/whatsapp/webhook' }}` |
| Body | JSON |
| JSON Body | `={{ $json.payload }}` |

**Headers:**

| Name | Value |
|------|--------|
| Content-Type | application/json |
| X-MDoctor-Webhook-Secret | `={{ $env.N8N_WEBHOOK_SECRET }}` |
| X-Correlation-Id | `={{ $json.correlationId }}` |
| Idempotency-Key | `={{ $json.idempotencyKey }}` |
| X-N8N-Workflow | typebot-webhook-staging |

**Options → Response:** Never Error = ON, Full Response = OFF

---

### NODE 4 — Wrap Response (Code)

Mode: **Run Once for All Items**

```javascript
const backend = $input.first().json || {};
const ctx = $('Build Payload').first().json;
return [{
  json: {
    ok: backend.success !== false,
    success: backend.success !== false,
    duplicate: Boolean(backend.duplicate),
    correlationId: ctx.correlationId,
    atendimento: backend.atendimento || null,
    upload_url: backend.upload_url || null,
    status: backend.status || null,
    prescription_upload_pending: Boolean(backend.prescription_upload_pending)
  }
}];
```

---

### NODE 5 — Resposta Sucesso (Respond to Webhook)

| Campo | Valor |
|-------|--------|
| Respond With | **JSON** |
| Response Code | 200 |

**Response Body** (cole na caixa de expressão — deve começar com `=`):

```
={{ JSON.stringify({ success: true, message: 'Triagem recebida com sucesso!', upload_url: $json.upload_url || null }) }}
```

**NÃO use** URL fixa com `...`. O `upload_url` vem do backend via **Wrap Response**.

---

## Variáveis de ambiente no Railway (serviço n8n-staging)

```
FLOW_ENV=staging
BACKEND_URL_STAGING=https://mdoctor-backend-staging-staging.up.railway.app
N8N_WEBHOOK_SECRET=staging-n8n-webhook-20260528
WEBHOOK_URL=https://n8n-staging-staging-2dfe.up.railway.app
```

---

## Teste rápido (PowerShell)

```powershell
$body = @{
  whatsapp = "5511999881100"
  Nome_Completo = "Teste Manual"
  data_nascimento = "01/01/1990"
  cpf_paciente = "52998224725"
  has_previous_prescription = "sim"
  has_prescription_photo_ready = "sim"
  payment_status = "paid"
  medication_count = 1
  med1_nome = "Losartana"
  med1_dose = "50"
  med1_frequencia = "1x"
  med1_via = "oral"
  doenca_cronica = "hipertensao"
  tempo_uso = "mais de 6 meses"
  eligibility_status = "eligible"
} | ConvertTo-Json

Invoke-RestMethod -Method POST `
  -Uri "https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook" `
  -ContentType "application/json" `
  -Body $body
```

**Esperado:**

```json
{
  "success": true,
  "message": "Triagem recebida com sucesso!",
  "upload_url": "https://painel-medico-staging-staging.up.railway.app/upload-receita/..."
}
```

Se `upload_url` for `null`, abra a execução no n8n e veja o output do **POST Backend** — o backend precisa retornar `upload_url` (variável `PRESCRIPTION_EXTERNAL_UPLOAD=true` no backend).

---

## Checklist final

- [ ] Só existe **um** Respond: **Resposta Sucesso**
- [ ] Wrap Response → Resposta Sucesso (ligado)
- [ ] Webhook usa **Respond to Webhook Node**
- [ ] Workflow **Active** (verde)
- [ ] Teste retorna JSON com `upload_url` preenchido
