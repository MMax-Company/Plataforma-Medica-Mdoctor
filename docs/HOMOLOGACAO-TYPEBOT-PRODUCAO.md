# Homologação funcional — Typebot real → fila médica (produção)

## Pré-requisitos (já validados)

| Camada | URL / estado |
|--------|----------------|
| Typebot produção | `doctor-prescreve-8rmljgu` (typebot.io) |
| Webhook n8n | `POST https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook` |
| Backend | `https://web-production-5f178.up.railway.app` |
| Rota triagem | `POST /api/webhook/triagem` |
| Workflow n8n ativo | `Typebot Webhook - Staging` (`VUDBmF4REtrj6ZJU`) |

## 1. Configurar Typebot real

No bloco **Webhook** (final do fluxo elegível), usar:

- **Método:** `POST`
- **URL:** `https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook`
- **Header:** `Content-Type: application/json`
- **Body:** export em `docs/typebot/typebot-doctor-prescreve-production.json` (já aponta para n8n produção)

Publicar via API (token em secrets):

```bash
TYPEBOT_API_TOKEN=... node mdoctor-backend/scripts/publish-typebot-production.js
```

Ou importar manualmente o JSON no builder Typebot.

### Formato de payload

O Typebot envia **payload flat** (campos `patient_name`, `pagamento_status`, `medications`, etc.). O n8n normaliza para:

```json
{
  "paciente": { "nome", "telefone", "cpf", "email" },
  "triagem": { "doencas", "medicacao_em_uso", "tempo_uso", "receita_anterior", "sinais_alerta", "observacoes" },
  "typebot_context": { "payment_status", "pagamento_status", "previous_prescription_file", ... }
}
```

O backend mescla `typebot_context` para preservar pagamento, elegibilidade e foto de receita na fila médica.

## 2. Variáveis n8n produção

| Variável | Valor |
|----------|--------|
| `BACKEND_BASE_URL` | `https://web-production-5f178.up.railway.app` |
| `N8N_WEBHOOK_SECRET` | mesmo valor do serviço `web` |

Republicar workflow após alterar `docs/n8n-workflows/typebot-webhook-staging.json`:

```bash
N8N_PROD_DATABASE_URL=... node mdoctor-backend/scripts/n8n-prod-deploy-workflow-json.js \
  --workflow-id VUDBmF4REtrj6ZJU \
  --file docs/n8n-workflows/typebot-webhook-staging.json
```

## 3. Script de homologação automatizada

Simula o POST do Typebot (flat) e valida atendimento + fila:

```bash
node mdoctor-backend/scripts/homologacao-typebot-producao.js
```

Variáveis opcionais:

- `HOMOLOG_PRESCRIPTION_URL` — URL pública da receita (necessária para `scope=medical`)
- `N8N_WEBHOOK_URL` / `BACKEND_URL`

## 4. Checklist manual (fluxo real com paciente teste)

1. Concluir Typebot com dados reais de teste (CPF válido, pagamento confirmado no fluxo).
2. Confirmar resposta do webhook Typebot: `success: true`, `atendimentoId`.
3. Se elegível com foto: `upload_url` pode vir preenchido ou `null` se receita já enviada no fluxo.
4. Painel médico: atendimento em `GET /api/atendimentos?scope=medical`.
5. Abrir prontuário no painel e conferir:
   - doença / condição
   - medicação
   - conduta sugerida
   - orientações
   - exame físico telemedicina

## 5. Critérios da fila médica

`GET /api/atendimentos?scope=medical` só lista atendimentos com:

- `pagamento_status` = `CONFIRMADO`
- `elegibilidade.eligible` = `true`
- status ≠ `rejected` / não aguardando upload externo
- foto de receita armazenada (URL ou storage path)

## 6. Fora de escopo desta homologação

Memed, Stripe (cobrança real), WhatsApp produção, automações extras, auditoria avançada.

## 7. Relatório

Preencher após cada rodada em `docs/HOMOLOGACAO-TYPEBOT-PRODUCAO-RELATORIO.json` (gerado pelo script) ou copiar saída do terminal.

Campos do relatório:

| Seção | Conteúdo |
|-------|----------|
| payload recebido | corpo flat Typebot |
| execução n8n | status + `atendimentoId` |
| atendimento criado | origem, status, elegibilidade, timestamps |
| fila médica | `atendimento_in_queue` |
| prontuário | queixa, conduta, orientações, exame |
| erros | lista |
| ajustes pendentes | lista |
