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

## Homologação em produção — 30/08/2026

PR #54 mergeado em `staging` (squash `76bb991`), auto-deploy em backend staging
e — por acoplamento de branch — no `web` de produção (ambos `SUCCESS`,
`/health` e `/readyz` 200, Supabase conectado, sem restart loop).

Teste em produção via `railway run` (sem Stripe, 1 atendimento `test_patient`
`medical_queue`/`waiting`/pago/elegível/foto fictícia, já removido):

| Verificação | Resultado |
|---|---|
| `admin_alert_dispatch` | 1 (`type: medical_queue`, `shortId: 48796F`) |
| `whatsappConfigured` | `true` |
| Template usado | `doctor_admin_alerta_fila_medica_v1` (`APPROVED`, `pt_BR`, `{{1}} = 48796F`) |
| Resposta síncrona da Meta | `message_status: accepted`, `wamid.HBgN…QjJDMjkyMUIxMAA=` |
| Webhook de status (assíncrono) | **`failed`** |

Erro no webhook de status:

```
code:  131042
title: Business eligibility payment issue
motivo: "your WhatsApp Business account payment has been restricted"
        (business_id 2276030586264187 / asset 1922123701817210 — a WABA de produção)
```

### O que isso comprova

1. O template `doctor_admin_alerta_fila_medica_v1` está `APPROVED` e foi
   **efetivamente usado em produção**.
2. A Meta **aceitou** o envio inicialmente (`message_status: accepted`) e
   retornou `wamid`.
3. A falha veio só no **webhook assíncrono**: `131042`, "Business eligibility
   payment issue", por **restrição de pagamento na WABA**.
4. Portanto:
   - o erro anterior `131047` / janela de 24 h foi **resolvido** pela migração
     para template (a Meta não reclamou de re-engajamento);
   - o bloqueio atual **não é do código**;
   - o bloqueio atual **não é do template**;
   - o bloqueio atual é **billing / elegibilidade da conta WhatsApp Business**
     e afeta qualquer envio (template ou texto livre), para qualquer
     destinatário.
5. O **Telegram continua funcionando** como canal paralelo independente
   (`dispatch telegram = sent`), cobrindo o requisito de o alerta chegar fora da
   janela de 24 h enquanto o WhatsApp está bloqueado.

### Por que não há fallback automático para o `131042`

O provider recebe `200 / accepted` **antes** do webhook de falha. Do ponto de
vista do código o envio do template teve sucesso; o `131042` chega depois, num
canal (webhook de status) que não realimenta o caminho de envio. Além disso, o
fallback de texto livre cairia no **mesmo** `131042` (mesma WABA). Não se deve
disparar reenvio automático a partir desse erro assíncrono.

## Próximo passo

1. Resolver a **restrição de pagamento da WABA `1922123701817210`** no billing
   hub da Meta (link no corpo do erro `131042`). **Não requer novo código.**
2. Depois disso, repetir **um único** teste `test_patient` (via `railway run`,
   sem Stripe) e confirmar a evolução do status do template:
   `accepted → sent → delivered` (não `failed`).
3. Se a qualidade do template cair para `PAUSED`, o fallback de texto livre
   mantém o comportamento anterior dentro da janela; Telegram sempre cobre.
