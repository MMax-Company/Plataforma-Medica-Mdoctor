# Fluxo da foto da receita anterior — Supabase atual

**Decisão arquitetural (vigente):** a foto da receita fica no **mesmo Supabase** do atendimento (`thbwoogytwcidxrrboym` no fluxo atual). Não há Supabase produção novo conectado nem migração parcial de arquivos.

```
Typebot (sem file input) → n8n → backend (sessão + link) → página externa upload → Storage → fila médica → prontuário
```

---

## Upload externo da receita anterior (sem file input Typebot)

**Motivo:** o plano free do Typebot não publica blocos `file input`. O upload é feito em página própria do Doctor Prescreve.

| Etapa | O que acontece |
|------|----------------|
| Typebot | Confirma que possui receita (`has_previous_prescription`); **não** envia arquivo |
| Após pagamento + medicamentos | Texto + botão **“Enviar foto da receita”** com `upload_url` |
| Paciente | Abre `/upload-receita/{token}` (painel ou backend) |
| Backend | `POST /api/upload-receita/:token` → Supabase `receitas-anteriores` |
| Fila médica | Só após upload: status `waiting`; antes: `awaiting_prescription_upload` |

**Variáveis:**

```env
PRESCRIPTION_EXTERNAL_UPLOAD=true
UPLOAD_PAGE_BASE_URL=https://painel-medico-staging-staging.up.railway.app
PUBLIC_BASE_URL=https://mdoctor-backend-staging-staging.up.railway.app
PRESCRIPTION_UPLOAD_TOKEN_TTL_MS=86400000
```

---

## 1. Typebot

| Item | Valor |
|------|--------|
| Confirmação de receita | `has_previous_prescription` / `has_prescription_photo_ready` (antes do pagamento) |
| **Não usar** | bloco `file input` nativo (exige plano pago para publish) |
| Após medicamentos | Mensagem + link `upload_url` retornado pelo backend |
| Campo legado (opcional) | `previous_prescription_file` — ignorado no fluxo externo |

Mensagem sugerida no bot:

> Para concluir sua solicitação, envie agora a foto da sua receita anterior. Seu atendimento só será encaminhado para análise médica após o envio da imagem.

Botão: **Enviar foto da receita** → URL `{upload_url}`

---

## 2. n8n (staging: `typebot-webhook-staging`)

| Node | Função |
|------|--------|
| Webhook Typebot | `POST /webhook/typebot-webhook` |
| Build Payload | Normaliza dados; **não** exige `previous_prescription_file` |
| POST Backend | `POST /api/whatsapp/webhook` — resposta inclui `upload_url` |
| **Não fazer** | download de arquivo do Typebot |

Código de referência: `docs/n8n-workflows/lib/typebot-webhook-payload.code.js`

**Produção (legado):** workflow `Doctor Prescreve — Typebot Produção` ainda grava `triagens`; alinhar para backend quando cutover.

---

## 3. Supabase Storage (atual)

| Item | Valor |
|------|--------|
| Bucket | `receitas-anteriores` (privado) |
| Env backend | `SUPABASE_BUCKET_RECEITAS_ANTERIORES=receitas-anteriores` |
| Path | `atendimentos/{atendimento_id}/receita-anterior-{timestamp}.{ext}` |
| Migration | `mdoctor-backend/supabase/migrations/20260528_receitas_anteriores_bucket.sql` |

**Tipos permitidos:** jpg, jpeg, png, pdf  
**Tamanho máximo:** 10 MB (`PREVIOUS_PRESCRIPTION_MAX_BYTES`)

---

## 4. Metadados no atendimento (`dados_clinicos`)

| Campo | Descrição |
|-------|-----------|
| `previous_prescription_url` | URL assinada (visualização) |
| `previous_prescription_storage_path` | Path no bucket |
| `previous_prescription_mime_type` | MIME validado |
| `previous_prescription_size` | Bytes |
| `previous_prescription_uploaded_at` | ISO timestamp |
| `previous_prescription_source` | `external_upload` (ou legado `typebot/n8n`) |
| `previous_prescription_file` | Alias legado (URL) |
| `foto_receita_url` | Exibido no painel |
| `prescription_ingest` | `{ ok, storage_path }` ou erro |

---

## 5. Backend

| Endpoint | Método | Auth | Uso |
|----------|--------|------|-----|
| `/api/whatsapp/webhook` | POST | `X-MDoctor-Webhook-Secret` | Cria atendimento; retorna `upload_url` se aguardando foto |
| `/api/upload-receita/:token` | POST | Token na URL (multipart `file`) | Paciente envia JPG/PNG/PDF |
| `/api/upload-receita/:token/status` | GET | Token na URL | Status da sessão |
| `/upload-receita/:token` | GET | Token na URL | Página HTML de upload (backend) |
| `/api/atendimentos/:id/previous-prescription/view-url` | GET | JWT médico | Signed URL no prontuário |
| `/api/whatsapp/ingest-previous-prescription` | POST | Webhook secret | Legado (URL externa); não usar com Typebot free |

**Serviços:** `prescription-upload-token.service.js`, `prescription-upload.service.js`, `previous-prescription-storage.service.js`

**Status:** `awaiting_prescription_upload` → após upload → `waiting` (fila médica)

**Regras sem foto:**

- `eligibility_status: ineligible`
- `status: rejected` (não entra na fila)
- `isVisibleInMedicalPanel()` = false

**Erros auditados:** `PRESCRIPTION_FILE_MISSING`, `PRESCRIPTION_MIME_INVALID`, `PRESCRIPTION_DOWNLOAD_FAILED`, `PRESCRIPTION_UPLOAD_FAILED`, etc.

---

## 6. Painel / prontuário

- Rota: `/atendimento/[id]`
- Botão: **RECEITA ANEXADA — VISUALIZAR IMAGEM**
- Com path no Storage: chama `GET .../previous-prescription/view-url` e abre signed URL
- Sem service role no frontend

---

## 7. Segurança

- Service role **apenas** backend (e ingest via endpoint protegido para n8n)
- Bucket privado + signed URL (TTL padrão 1h)
- Validação: ausente, MIME inválido, tamanho, download/upload

---

## 8. O que NÃO fazer agora

- Não conectar Supabase produção novo ao fluxo Typebot/n8n atual
- Não mover só a foto para outro projeto
- Não desconectar Supabase legado sem plano de migração validado

---

## 9. Validação (checklist)

| # | Teste | Staging 2026-05-29 |
|---|--------|---------------------|
| 1 | Typebot **sem** `file input`; link `upload_url` | ✅ publicado (staging safe) |
| 2 | n8n → backend | ✅ E2E; ⚠️ republicar workflow para corpo JSON com `upload_url` |
| 3 | Objeto em `receitas-anteriores/atendimentos/{id}/...` | ✅ |
| 4 | Metadados + `foto_receita_url` / `external_upload` | ✅ |
| 5 | Prontuário via signed URL | ✅ |
| 6 | Sem upload → fora da fila (`awaiting_prescription_upload`) | ✅ |
| 7 | `node scripts/test-external-upload-flow.js` | ✅ |
| 8 | `node scripts/staging-e2e-operacional.js` | ✅ **14/14** |

**Variáveis Railway (backend staging):** ver `docs/OPERACIONAL-FECHAMENTO-FINAL.md`.

**Limite arquivo:** 10 MB; **TTL token:** 24 h (`PRESCRIPTION_UPLOAD_TOKEN_TTL_MS=86400000`).

---

## 10. Plano futuro — Supabase produção novo (somente documentação)

Criar projeto **limpo** quando a migração for aprovada. Estrutura alvo (não conectar ao fluxo atual até cutover):

### Domínios de dados

| Domínio | Tabelas / objetos |
|---------|-------------------|
| Pacientes | `patients`, identificadores, contatos |
| Atendimentos | `atendimentos`, status, elegibilidade, `dados_clinicos` jsonb |
| Triagens | `triagens` ou eventos de triagem versionados |
| Prontuários | `medical_records`, snapshots clínicos |
| Medicamentos | catálogo + `medication_requests` por atendimento |
| Receitas anteriores | Storage `receitas-anteriores` + metadados no atendimento |
| Receitas emitidas | `prescriptions`, Memed ids, PDFs em `prescriptions` bucket |
| Termos | `consent_acceptances`, links versionados |
| Entregas | `delivery_logs` (WhatsApp/e-mail) |
| Auditoria | `audit_logs` imutáveis |
| Logs operacionais | `logs` bucket + tabela de eventos |
| Suporte | fila suporte WhatsApp |
| Pagamentos | `payments`, status, idempotência |
| Integrações | webhooks, correlation_id, secrets refs |

### Storage buckets (produção)

- `receitas-anteriores` (privado)
- `prescriptions` (privado, receitas emitidas)
- `documents`, `medical-records`, `consents`, `logs`

### Segurança

- RLS por `service_role` no backend; médicos via API com JWT
- Sem anon write em buckets clínicos
- Triggers: `updated_at`, auditoria em mudança de status

### Cutover (futuro)

1. Validar fluxo completo no Supabase **atual**
2. Provisionar projeto produção + migrations base
3. Migração batch (pacientes → atendimentos → storage)
4. Trocar `SUPABASE_URL` + secrets em Railway (backend, n8n via backend)
5. Smoke E2E produção; rollback documentado

Referência SQL inicial: `mdoctor-backend/supabase/migrations/20260527_backend_mvp_storage.sql` + `20260528_receitas_anteriores_bucket.sql` e `docs/supabase-upgrade-production.sql`.

---

## Referências no repositório

- `mdoctor-backend/src/services/previous-prescription-storage.service.js`
- `mdoctor-backend/src/routes/whatsapp.routes.js`
- `docs/n8n-workflows/typebot-webhook-staging.json`
- `docs/TYPEBOT-FLUXO-REORGANIZADO.md`
