# Operação assistida — Typebot real (produção)

## URL do bot publicado

| Item | Valor |
|------|--------|
| `publicId` | `doctor-prescreve-8rmljgu` |
| Link público | https://typebot.co/doctor-prescreve-8rmljgu |
| Webhook esperado | `POST https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook` |
| `TYPEBOT_ID` (API) | `higij2z0xihxxkr378rmljgu` |

## 1. Conferir webhook (export + API)

```bash
# Só export (sem token)
node mdoctor-backend/scripts/inspect-typebot-production-webhook.js

# Com token — compara bot publicado na typebot.io
TYPEBOT_API_TOKEN=... node mdoctor-backend/scripts/inspect-typebot-production-webhook.js
```

## 2. Publicar se a API divergir do export

```bash
TYPEBOT_API_TOKEN=... node mdoctor-backend/scripts/publish-typebot-production.js
```

Export de referência: `docs/typebot/typebot-doctor-prescreve-production.json`

## Fechamento operacional (2026-05-29)

Homologação encerrada com `node mdoctor-backend/scripts/fechar-operacao-assistida-typebot.js`.

Relatório: `docs/OPERACAO-ASSISTIDA-TYPEBOT-PRODUCAO-RELATORIO.json`

| Critério | Status |
|----------|--------|
| Bot publicado (`startChat` 200) | OK |
| Webhook produção no export | OK |
| Passagem controlada → n8n → backend | OK |
| Fila médica | OK |
| Prontuário automático | OK |

## 3. Passagem controlada (paciente teste)

1. Abrir https://typebot.co/doctor-prescreve-8rmljgu
2. Usar nome identificável, ex.: `Teste Operação Assistida <data>`
3. CPF válido de teste, telefone real ou fictício com DDD
4. Concluir fluxo elegível com **pagamento confirmado** no Typebot
5. Enviar **foto/URL de receita anterior** quando o fluxo solicitar
6. Anotar `atendimentoId` se o Typebot exibir resposta do webhook (`upload_url` / sucesso)

## 4. Validar backend e fila

```bash
ATENDIMENTO_ID=<uuid> node mdoctor-backend/scripts/verificar-operacao-assistida-typebot.js
```

Ou busca automática (últimas 2h, filtro por nome):

```bash
PACIENTE_NOME_CONTAINS="Operação Assistida" node mdoctor-backend/scripts/verificar-operacao-assistida-typebot.js
```

## 5. Critérios de aceite

| Campo | Esperado |
|-------|----------|
| `origem` | `typebot-triagem` |
| `status` | `waiting` |
| `pagamento_status` | `CONFIRMADO` |
| `elegibilidade.eligible` | `true` |
| `elegibilidade.riskLevel` | `BAIXO` |
| Fila `scope=medical` | atendimento listado |
| Prontuário | queixa, conduta, orientações, exame preenchidos |
| Receita | `previous_prescription_file` ou URL em `dados_clinicos` |

## 6. Relatório final

Salvar saída do verificador em:

`docs/OPERACAO-ASSISTIDA-TYPEBOT-PRODUCAO-RELATORIO.json`

## Fora de escopo

Memed, Stripe, WhatsApp produção, auditoria avançada, alterações no painel médico.
