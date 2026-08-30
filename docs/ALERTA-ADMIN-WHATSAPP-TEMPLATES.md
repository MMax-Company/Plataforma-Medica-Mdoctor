# Alerta administrativo no WhatsApp — templates Utility

**Última atualização:** 30/08/2026

## Problema

O alerta interno "novo paciente na fila médica / novo chamado no suporte / novo
suporte médico" (`admin-alert.service.js`) enviava **texto livre** pela Meta
Cloud API. Texto livre só é entregue **dentro da janela de atendimento de 24 h**
(o administrador precisaria ter respondido ao número do business nas últimas
24 h). Fora dessa janela a Meta responde no webhook de status:

```
status = failed
errors = [{ code: 131047, title: "Re-engagement message",
  details: "Message failed to send because more than 24 hours have passed
            since the customer last replied to this number." }]
```

Comprovado em produção em 30/08/2026 (message id `wamid.HBgN…89BA7C3E…`,
recipient `*********0111`) — a mensagem foi aceita pela API (`providerStatus:
sent`) mas **falhou na entrega** (`131047`). O canal Telegram (Plano B) entrega
normalmente.

## Solução

Enviar o alerta como **template Utility aprovado**. Templates Utility são
entregues **também fora da janela de 24 h**. Telegram permanece como canal
paralelo independente.

## Templates (WABA de produção `1922123701817210`, app `1596975004894790`)

| Nome | Idioma | Categoria | Status | Corpo aprovado |
|---|---|---|---|---|
| `doctor_admin_alerta_fila_medica_v1` | pt_BR | UTILITY | **APPROVED** | `🔴 ALERTA MÉDICO\nNovo paciente aguardando atendimento médico.\nAtendimento #{{1}} registrado.` |
| `doctor_admin_alerta_suporte_v1` | pt_BR | UTILITY | **APPROVED** | `🔵 ALERTA SUPORTE\nNovo chamado aguardando atendimento no suporte.\nTicket #{{1}} registrado.` |
| `doctor_admin_alerta_suporte_medico_v1` | pt_BR | UTILITY | **APPROVED** | `🟢 ALERTA SUPORTE MÉDICO\nNovo atendimento aguardando avaliação do suporte médico.\nAtendimento #{{1}} registrado.` |

- Cada template: 1 componente `BODY`, 1 variável posicional `{{1}}` = `shortId`
  (`admin-alert.service.js` → `shortIdFrom(id)`, 6 caracteres hex maiúsculos).
- `rejected_reason: NONE`. `quality_score: UNKNOWN` (sem tráfego ainda).
- Aprovados em 30/08/2026 (~06:40 UTC). Utilizáveis pelo número de produção
  (`WHATSAPP_PHONE_NUMBER_ID` na mesma WABA).

Consulta (somente leitura), via env de produção:
`GET https://graph.facebook.com/v25.0/{WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`.

## Implementação

Antes de 30/08/2026 existia apenas uma versão **não commitada** no working tree
do checkout principal (`admin-alert.service.js` + `meta.provider.js` +
`scripts/test-admin-alert-templates.js`), baseada num `admin-alert.service.js`
antigo — não aplicava sobre a baseline atual e ficou de fora de todas as
promoções (à época os templates estavam `PENDING`).

Reimplementado sobre `d55a1c2` (PR `fix/admin-alert-whatsapp-template-20260830`):

- `meta.provider.js` → `sendTemplateMessage({ to, name, languageCode, bodyParameters })`
  (`type: 'template'`, `components: [{ type: 'body', parameters: [...] }]`).
- `admin-alert.service.js` → `ALERT_TEMPLATES` mapeia `type` → nome do template.
  `sendWhatsAppAlert`: **primário** = template; **fallback** = texto livre
  (`ALERT_TEXTS`, mantido, só entrega dentro da janela) se o template falhar
  (ex.: `PAUSED` por queda de qualidade). Retorno `'sent' | 'skipped' | 'failed'`
  inalterado. `sendTelegramAlert` e `notifyAdminAlert` inalterados.
- O ponto único de disparo (`atendimentos.store.js → announceMedicalQueueEntryOnce`,
  PR #53) e a idempotência por `dados_clinicos.medical_queue_alert_sent_at`
  permanecem intactos.
- Teste: `scripts/test-admin-alert-templates-unit.js`.

## Próximo passo

1. Homologar `fix/admin-alert-whatsapp-template-20260830` em `staging`
   (auto-deploy no backend staging e — por acoplamento de branch — no `web` de
   produção).
2. Validar entrega **fora da janela de 24 h**: disparar 1 alerta `medical_queue`
   de teste (`test_patient`, via `railway run`, sem Stripe) e conferir o webhook
   de status da Meta = `sent` → `delivered` (não `failed`/`131047`).
3. Se a qualidade do template cair para `PAUSED`, o fallback de texto livre
   mantém o comportamento anterior dentro da janela; Telegram sempre cobre.
