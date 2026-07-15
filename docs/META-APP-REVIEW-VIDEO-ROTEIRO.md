# Roteiro de vídeo — App Review Meta (WhatsApp Business Platform)

Este documento é o roteiro para gravar o(s) vídeo(s) exigidos pela Meta no
App Review das permissões do Doctor Prescreve na WhatsApp Business Platform.
**Ainda não gravado.** Ver a seção "Pendências de homologação" no fim deste arquivo.

## Permissões cobertas

1. `whatsapp_business_management` — gestão de templates da WABA (list, create,
   delete). Capacidade implementada em `mdoctor-backend/src/services/providers/meta.provider.js`
   (`listMessageTemplates`, `createMessageTemplate`, `deleteMessageTemplate`) e
   exposta em `GET/POST/DELETE /api/admin/whatsapp/templates`.
2. `whatsapp_business_messaging` — envio/recebimento de mensagem (se também for
   solicitada nesta submissão). Capacidade implementada em `sendTextMessage`/
   webhook `POST /api/whatsapp/webhook`.

A Meta exige que o vídeo mostre o **app real fazendo a chamada de API**, não a
documentação nem o Graph API Explorer. Precisa correlacionar visualmente a ação
no app com o efeito real na WABA (visível no Meta Business Manager).

## Pré-requisitos antes de gravar

- WABA de teste/homologação já vinculada a um número de teste (não usar o
  número de produção real do Doctor Prescreve nesta gravação).
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e
  `WHATSAPP_BUSINESS_ACCOUNT_ID` configurados em um ambiente de staging isolado
  (nunca em produção — ver restrição no topo desta tarefa).
- Um usuário admin válido no painel/backend (JWT) para autenticar as chamadas.
- Cliente HTTP para narrar as chamadas na tela (curl, Postman/Insomnia, ou o
  painel administrativo se a tela correspondente já existir).
- Aba separada aberta no Meta Business Manager (business.facebook.com →
  WhatsApp Manager → Modelos de mensagem) para mostrar o "antes/depois" em
  tempo real.

## Roteiro passo a passo — whatsapp_business_management

1. **Abertura (10s)** — tela mostrando o painel/app do Doctor Prescreve
   logado como admin. Narração: "Vamos demonstrar o uso da permissão
   whatsapp_business_management para gerenciar os templates da nossa WABA."
2. **Listar templates existentes** — chamar
   `GET /api/admin/whatsapp/templates` (com o Bearer token do admin visível
   no header, mas com o token real borrado/oculto na gravação). Mostrar o
   JSON de resposta com os templates reais da WABA.
3. **Correlacionar com o Business Manager** — trocar para a aba do WhatsApp
   Manager e mostrar a mesma lista de templates, com os mesmos nomes/status,
   provando que a chamada é contra a WABA real (não mock).
4. **Criar um template novo** — chamar
   `POST /api/admin/whatsapp/templates` com um payload de teste (ex.: nome
   `doctorprescreve_review_demo`, categoria `UTILITY`, idioma `pt_BR`).
   Mostrar a resposta com `status: "PENDING"`.
5. **Confirmar no Business Manager** — voltar à aba do WhatsApp Manager,
   atualizar a lista e mostrar o novo template aparecendo com status
   pendente — prova visual de que a ação do app management teve efeito real
   na WABA.
6. **Excluir o template de teste** — chamar
   `DELETE /api/admin/whatsapp/templates/doctorprescreve_review_demo` e
   mostrar, de novo no Business Manager, o template desaparecendo da lista.
   Isso demonstra a capacidade de "gerenciar" (não só listar).
7. **Encerramento (10s)** — resumo em narração: "Essas três chamadas —
   listar, criar e excluir — cobrem o uso da permissão
   whatsapp_business_management pelo Doctor Prescreve."

## Roteiro passo a passo — whatsapp_business_messaging (se aplicável)

1. Mostrar o webhook configurado (`GET /api/whatsapp/webhook` respondendo à
   verificação `hub.challenge`).
2. Enviar uma mensagem de teste do número de teste da WABA para o número
   business de teste do Doctor Prescreve.
3. Mostrar nos logs do backend (`WhatsApp business message received` /
   `processed`) a mensagem sendo recebida e processada.
4. Disparar um envio de resposta via `meta.provider.sendTextMessage` (por
   exemplo, através do fluxo de suporte) e mostrar a mensagem chegando no
   WhatsApp do número de teste.

## Regras de gravação

- Nunca gravar contra a WABA/número de produção real — usar sempre ambiente
  de teste dedicado.
- Não expor tokens de acesso, JWTs ou API keys em texto legível na tela.
- O vídeo precisa ser contínuo (sem cortes que escondam passos) e mostrar a
  URL/domínio do app do Doctor Prescreve visível, para a Meta confirmar que é
  o app real submetido no App Review.

## Pendências de homologação

- [ ] Provisionar WABA de teste dedicada (separada da produção) com número de
      teste.
- [ ] Gerar `WHATSAPP_ACCESS_TOKEN` de longa duração (system user) e
      `WHATSAPP_BUSINESS_ACCOUNT_ID` para o ambiente de gravação.
- [ ] Confirmar com a documentação/suporte da Meta o campo real de "parent
      BSUID" em mensagens inbound (hoje é inferência não confirmada — ver
      `src/services/whatsapp-meta-identity.service.js`).
- [ ] Gravar os vídeos seguindo este roteiro.
- [ ] Submeter o App Review na Meta com os vídeos e a descrição do caso de
      uso.
- [ ] Somente após aprovação: aplicar a migration
      `20260715_whatsapp_sessions_bsuid.sql`, preencher as variáveis de
      produção e decidir se/quando migrar `WHATSAPP_PROVIDER` de `evolution`
      para `meta` (Evolution continua sendo o provider real até essa decisão
      explícita).
