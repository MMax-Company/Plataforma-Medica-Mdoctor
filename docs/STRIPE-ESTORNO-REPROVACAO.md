# Fluxo Stripe — estorno somente para pacientes reprovados

## Regra de negócio

O estorno é permitido somente após uma decisão médica explícita de reprovação
no endpoint clínico oficial. Inelegibilidade automática na triagem, abandono,
cancelamento do checkout, erro técnico e atendimento ainda não avaliado não
disparam estorno.

## Fluxo proposto

1. O médico confirma a reprovação e informa o motivo clínico obrigatório.
2. O backend persiste a decisão clínica e bloqueia emissão de receita.
3. Se `pagamento_status` não for `CONFIRMADO`, registra
   `sem_pagamento_confirmado` e não chama a Stripe.
4. Se o pagamento estiver confirmado, o backend localiza o PaymentIntent pelo
   snapshot do webhook ou pela tabela `payments`. Nunca aceita um ID informado
   apenas pelo cliente/painel como fonte única.
5. O backend cria um refund integral com metadata do atendimento e chave de
   idempotência estável por atendimento.
6. O atendimento guarda `refund_id`, status, valor, moeda, timestamps e ator.
   A tabela `payments` passa para `refunded` somente quando o refund for
   confirmado como concluído.
7. Eventos `refund.updated` e `charge.refund.updated` reconciliam estados
   assíncronos (`pending`, `requires_action`, `succeeded`, `failed`).
8. A mensagem ao paciente informa reprovação e estorno iniciado; prazo de
   crédito depende do banco/emissor. Se o refund falhar, cria-se pendência
   administrativa e alerta operacional, sem desfazer a reprovação clínica.

## Controles obrigatórios antes de ativar

- Usar chave Stripe restrita e separada por ambiente, com permissões mínimas
  para Checkout Sessions, PaymentIntents e Refunds.
- Verificar assinatura de todos os webhooks e manter idempotência por `event.id`.
- Usar uma chave de idempotência estável, como
  `clinical-reject-refund:<atendimento_id>`, sem número de tentativa.
- Não aceitar `payment_intent` arbitrário enviado pelo painel; confirmar vínculo
  com o atendimento e valor/moeda registrados pelo webhook.
- Testar em modo Stripe de teste: sucesso, duplo clique, refund pendente, falha,
  pagamento ausente e webhook repetido/fora de ordem.
- Exibir no painel uma fila administrativa para refunds pendentes ou falhos.

## Estado atual (atualizado em 02/08/2026)

Estorno automático **reativado** a pedido explícito do Max: `clinical-decision
.service.js` (função `rejectAtendimento`) agora chama `refundRejectedAtendimento`
sempre que a reprovação médica ocorre com `pagamento_status = CONFIRMADO`. O
`payment_intent` nunca é aceito do corpo da requisição/painel — só das fontes
verificadas pelo webhook Stripe (`dados_clinicos.stripe_payment`, tabela
`payments`), conforme o controle obrigatório acima. Se o estorno não for
concluído (erro, `payment_not_found`, chave ausente etc.), o atendimento cai
para `pendencia_pagamento.status = pendente_analise_administrativa` — a
reprovação clínica nunca é desfeita nem bloqueada por falha de estorno.

Pendências que **continuam em aberto** e não foram resolvidas nesta mudança:

- Não existe fila administrativa no painel (`mdoctor-panel`) para visualizar
  estornos pendentes/falhos — o dado fica só em `dados_clinicos.estorno` e
  `dados_clinicos.pendencia_pagamento`, sem tela dedicada.
- Chave Stripe ainda não confirmada como restrita/separada por ambiente (ver
  auditoria de produção — pendente confirmação manual do Max no dashboard).
- Testes de teste em modo Stripe de teste (`scripts/test-clinical-reject-refund
  .js`) ainda não foram reexecutados contra este código; script já cobre
  sucesso, duplo clique e pagamento ausente, mas exige `STRIPE_SECRET_KEY`
  `sk_test_` — não roda com chave live.
- Mensagem WhatsApp de reprovação (`CLINICAL_REJECT_WHATSAPP_MESSAGE`) não foi
  alterada nesta mudança (fora do escopo autorizado) — continua com o texto
  genérico "Nossa equipe analisará as providências administrativas", mesmo
  quando o estorno já foi iniciado automaticamente.

## Achado corrigido nesta revisão (02/08/2026)

`applyStripeRefundReconciliation` (stripe-webhook.service.js) chamava
`updateAtendimentoStatus(atendimentoId, atendimento.status, { dados_clinicos })`
sem `motivo`/`medicoId`. O store (`atendimentos.store.js`) trata esses dois
campos como sempre-presentes (`meta.motivo || ... || null`, sem checar
`undefined`), então toda reconciliação de estorno via webhook — o caminho
normal para Pix, que confirma de forma assíncrona — apagava
`motivo_decisao`/`medico_id` do atendimento, mesmo sem qualquer decisão nova.
Corrigido repassando `atendimento.motivo_decisao`/`atendimento.medico_id`
(já carregados por `getAtendimento`) para preservar o valor existente.
`scripts/test-stripe-webhook-refund-reconciliation.js` ganhou o cenário
`2b` e um stub fiel ao comportamento real do store para travar a regressão.

## Plano de testes (preparado 02/08/2026 — nada executado além dos offline)

### Offline (já executados nesta revisão, sem rede/Stripe/Supabase reais)

Todos os 4 scripts abaixo rodam com `node scripts/<arquivo>.js` e passaram
100% após o fix acima:

- `test-clinical-decision-approve-reject.js` — aprovação/reprovação
  idempotentes; reprovação com pagamento confirmado chama o estorno
  automático; `payment_intent` do corpo da requisição nunca chega ao
  serviço de estorno; sem pagamento confirmado o estorno nem é chamado.
- `test-stripe-refund-checkout-session-resolution.js` — resolução do
  `payment_intent` a partir de `stripe_payment`, `stripe_checkout_session_id`
  e fallback pela tabela `payments`, incluindo falha da API Stripe.
- `test-stripe-webhook-refund-reconciliation.js` — reconciliação de
  `refund.created/updated/failed`; só aceita o `refund_id` que o próprio
  backend registrou; preserva `motivo_decisao`/`medico_id` (cenário 2b,
  achado desta revisão).
- `test-typebot-payment-pix-checkout-session.js` — Checkout Session do
  fluxo WhatsApp/Typebot inclui cartão+Pix, Pix expira em 1800s, cartão
  continua primeiro na lista, valor/moeda sem regressão.

### Staging (requer autorização explícita antes de qualquer execução real)

Pré-condições a confirmar manualmente antes de começar:

1. Chave `STRIPE_SECRET_KEY` de staging é restrita e separada de produção
   (pendência já registrada na memória do projeto — nunca confirmada).
2. No Dashboard Stripe (modo do ambiente de staging): Pix habilitado como
   payment method, e os eventos `refund.created`, `refund.updated`,
   `refund.failed` assinados no endpoint de webhook de staging (o código
   pressupõe isso já configurado; nada no repo garante essa assinatura).

Roteiro de validação (todos os passos exigem autorização e ambiente de
staging antes de executar; nenhum foi rodado):

1. Fluxo cartão completo: atendimento via WhatsApp/Typebot em staging,
   pagamento com cartão de teste Stripe, reprovação clínica, confirmar
   `dados_clinicos.estorno.status = succeeded` e
   `pendencia_pagamento.status = estorno_concluido`.
2. Fluxo Pix completo: mesmo roteiro pagando com Pix de teste — cobre o
   caminho assíncrono (`pending` na criação, `succeeded` só depois via
   webhook `refund.updated`); confirmar no banco que a reconciliação NÃO
   apaga `motivo_decisao`/`medico_id` do atendimento.
3. `payment_intent` forjado: reprovar enviando um `payment_intent` falso no
   corpo da requisição e confirmar que o estorno usa o pagamento real
   vinculado ao atendimento, não o do corpo (unit já cobre; repetir
   ponta a ponta contra o endpoint real).
4. Sem pagamento confirmado: reprovar atendimento com `pagamento_status`
   diferente de `CONFIRMADO` e confirmar que nenhuma chamada à Stripe
   acontece.
5. Duplo clique / retry: reprovar o mesmo atendimento duas vezes e
   confirmar que não é criado um segundo refund (idempotência pela chave
   `clinical-reject-refund:<atendimento_id>:<attempt>` e pelo estado já
   persistido em `dados_clinicos.estorno`).
6. Webhook fora de ordem/duplicado: reenviar manualmente (ou via CLI da
   Stripe) o mesmo evento de refund já reconciliado e confirmar que não
   duplica auditoria nem regrava o mesmo estado (`duplicate: true`).
7. Preço: confirmar que a Checkout Session criada em staging cobra
   R$ 49,90 (não mais R$ 69,90) e que o valor aparece corretamente na
   tela de pagamento do Typebot.
8. Regressão: confirmar que aprovação e reprovação sem pagamento
   confirmado continuam funcionando sem tentar estornar.
