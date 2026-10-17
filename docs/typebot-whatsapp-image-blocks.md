# Blocos de imagem no fluxo Typebot → WhatsApp

**Data:** 2026-09-10
**Escopo:** alteração isolada. Não relacionada à migração de WABA nem ao gate
de pagamento do Typebot.

## Objetivo

Permitir inserir **blocos de imagem** no Typebot (logo do Doctor Prescreve,
imagens institucionais, imagens educativas) e entregá-los **nativamente** na
conversa do WhatsApp (mensagem `type: image` da Meta Cloud API), na posição
correspondente do fluxo — nunca como link em texto.

Genérico: qualquer bloco de imagem compatível inserido no Typebot passa a ser
entregue. Não há código específico para uma logo.

## Estrutura do bloco de imagem no Typebot (auditado)

Export usado como referência:
`docs/typebot/typebot-export-doctor1009.json` (Typebot v6.1, `doctor-prescreve-8rmljgu`).
Há 2 blocos de imagem hoje: grupo **"Bem-Vindo"** (`s7YqZTBeyCa4Hp3wN2j922c`) e
grupo **"Nao elegivel"** (`r71bvnqwpkrgg0imlurts8hf`).

Bloco no builder e mensagem no runtime têm o mesmo formato:

```json
{ "id": "...", "type": "image", "content": { "url": "https://s3.typebot.io/..." } }
```

Confirmado no runtime real (`POST typebot.io/api/v1/typebots/doctor-prescreve-8rmljgu/startChat`):
`messages` do grupo Bem-Vindo = `["image", "text"]`, imagem com
`content.url = https://s3.typebot.io/public/.../blocks/s7YqZTBeyCa4Hp3wN2j922c?v=...`
(PNG público, HTTP 200, ~158 KB). Não há campo de caption nativo no bloco de
imagem v6 — quando existir legenda, ela normalmente é um bloco de texto
separado logo depois (a ordem é preservada).

## Alteração

Somente entrega de imagem; nada de lógica clínica, elegibilidade, pagamento,
Stripe, Memed, painel, upload ou input esperado do Typebot.

### `mdoctor-backend/src/services/providers/meta.provider.js`

- `sendImageMessage({ to, bsuid, recipientId, imageUrl, mediaId, caption, correlationId, idempotencyKey })`:
  - valida `imageUrl` como `https://…` — senão lança `META_INVALID_IMAGE_URL`;
  - **sobe a imagem para o endpoint `/media` da Meta e envia por `image.id`**
    (não por `image.link`). Motivo: imagem por `link` só é entregue depois que
    a Meta busca/valida a URL — chega **depois** do texto enviado logo em
    seguida e a ordem no aparelho quebra. Confirmado no teste real 10/09:
    log `outputKinds=["image","text","buttons"]` e os 3 envios nessa ordem
    (0,4 s de intervalo, sem `Promise.all`), mas o WhatsApp entregou
    texto → botão → imagem. Enviando por `id` a mídia já está processada e é
    entregue na ordem.
  - `mediaId` direto também é aceito (envia por `id` sem re-upload).
  - `media_id` cacheado por URL (TTL 20 min, por processo) para não re-subir a
    mesma imagem em bursts.
  - se o upload falhar (download, tipo não-imagem, >5 MB, recusa da Meta):
    `logger.warn('meta_image_upload_fallback_link')` e cai para `image.link` —
    a imagem ainda é entregue (podendo ficar fora de ordem), sem derrubar nada.
  - caption só quando houver, truncado a 1024.
- Exportados `sendImageMessage` e `uploadImageFromUrl`.
- O laço de envio do bridge **não mudou** — já enviava cada output com `await`
  em sequência (comprovado nos logs). A correção de ordem é o envio por
  `media_id`, dentro de `sendImageMessage`.

### `mdoctor-backend/src/services/typebot-whatsapp.bridge.js`

- Novo helper `imageOutputFromMessage(message)` → `{ kind: 'image', url, caption? }`
  (aceita `content.url` string ou `{ url }`; caption de `content.caption` ou
  `content.plainText`; retorna `null` se não houver URL).
- `convertTypebotResponse`: mensagens `type: 'image'` viram output `image` **na
  posição em que o Typebot as devolveu** (antes eram silenciosamente
  descartadas pelo `if (message.type !== 'text') continue`). Ordem
  imagem → texto → pergunta → opções é preservada.
- Laço de envio: `output.kind === 'image'` → `provider.sendImageMessage(...)`
  dentro de `try/catch`. Falha (URL inválida, host fora do ar, Meta recusa)
  gera `logger.warn('typebot_bridge_image_failed', …)` e **segue para o próximo
  output** — não derruba, não reinicia a sessão, não cria sessão nova, não
  altera o input esperado. Não incrementa `providerMessageIds` → não conta como
  mensagem enviada, sem duplicação.

### `typebot-prescription-upload.service.js` e `typebot-payment-link.service.js`

- Os laços `sendTypebotOutputs` (retomada pós-upload e pós-pagamento) ganharam
  o mesmo ramo `image` resiliente, para o passthrough ser genérico em todos os
  caminhos que renderizam resposta do Typebot. Nenhuma lógica de pagamento/
  upload foi tocada — só a renderização de output do tipo imagem.

## Testes

Novo: `mdoctor-backend/scripts/test-typebot-whatsapp-image-blocks.js`
(`npm run test:typebot-whatsapp-image-blocks` no backend). Cobre: ordem
preservada, URL crua (nunca link textual), caption opcional, imagem sem URL
ignorada, `content.url` como objeto, payload Meta `type: image`, e
`META_INVALID_IMAGE_URL` para URL não-HTTPS.

Regressão OK: `test-typebot-whatsapp-long-eligibility.js`,
`test-typebot-prescription-upload.js` (19/19) e
`test-whatsapp-meta-provider-dispatch.js` seguem passando.

Testes que **já falhavam antes** desta alteração (confirmado com `git stash` —
nenhum tem relação com imagem): `test-whatsapp-menu-routing-unit.js`,
`test-cta-url-legal-docs-20260724.js` (snapshot Typebot desatualizado),
`test-whatsapp-typebot-bridge.js` (rótulo "Pol. Privacidade" vs "Política
Privacidade"), `test-typebot-payment-link.js`,
`test-typebot-payment-upload-link.js` (`PERSISTENCE_REQUIRED` — exige DB).

## Validação obrigatória (pendente — precisa de teste real no 4946)

1. Inserir um bloco de teste com imagem no Typebot (URL HTTPS pública válida).
2. Iniciar atendimento real pelo +55 11 94570-4946.
3. Confirmar imagem recebida nativamente no WhatsApp (não link).
4. Confirmar sequência correta com o texto/pergunta seguinte.
5. Confirmar que a resposta do paciente continua chegando ao mesmo bloco/sessão.
6. Confirmar ausência de duplicação.
7. Confirmar que uma URL inválida de imagem só gera log
   `typebot_bridge_image_failed` e o atendimento segue normalmente.
