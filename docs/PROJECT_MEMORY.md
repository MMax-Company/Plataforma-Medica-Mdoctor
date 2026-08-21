# Memória Compartilhada — Doctor Prescreve

**Última atualização:** 21/08/2026
**Responsável funcional:** Dr. Max Vinicius Ferreira Matos  
**Finalidade:** fonte canônica compartilhada entre Claude Code, Codex e futuros
agentes. Deve ser lida antes de qualquer trabalho no projeto.

## 1. Protocolo obrigatório de início

1. Ler `CLAUDE.md`, `AGENTS.md` e este arquivo por inteiro.
2. Confirmar repositório, branch, alterações locais e ambiente-alvo.
3. Investigar o código e a fonte de dados do fluxo solicitado antes de propor
   ou executar uma correção.
4. Verificar se já existe helper, serviço, rota ou componente equivalente.
5. Se houver conflito entre pedido, memória e comportamento atual, perguntar.

## 2. Ambientes e deploy

- **Staging continua sendo o ambiente padrão de desenvolvimento e validação.**
- Painel staging: `https://painel-medico-staging-staging.up.railway.app`.
- Backend staging: `https://mdoctor-backend-staging-staging.up.railway.app`.
- Painel produção: `https://web-production-02fde.up.railway.app`.
- Backend produção: `https://web-production-5f178.up.railway.app`.
- Branch oficial de produção: `main`. Branch oficial de homologação: `staging`.
- Railway acompanha automaticamente a ponta das branches: produção → `main` e
  homologação → `staging`; nenhum dos quatro serviços mantém `commitSha` fixo.
- Não alterar `main`, produção, serviços ou dados de produção sem autorização
  explícita do usuário na solicitação atual.
- "Faça commit e deploy" não autoriza produção por si só; usar staging enquanto
  o usuário estiver revisando o painel.
- Antes do deploy, confirmar branch e serviço Railway vinculados.
- Estado promovido e validado em 21/08/2026: produção `main` no commit
  `30c5742359c53330288aaa46588ce3864d22d585`; staging no commit
  `13a1d5fe6f067bbfd5a9a894d10add72a456fad4`. Os SHAs diferem pelo rebase
  do PR de promoção, mas as árvores Git são idênticas
  (`6d0eb87a2d4edafc525c2dbd9345597e7d68096f`).

## 3. Definição de pedido econômico

"Pedido econômico" significa:

- alteração direta e limitada ao problema solicitado;
- investigação pontual, nunca auditoria ampla;
- sem varreduras gerais, testes exaustivos ou refatoração não solicitada;
- reutilizar evidências e diagnósticos existentes;
- executar somente a validação essencial do fluxo alterado;
- relatório final curto: resultado, commit e ambiente.

## 4. Regras permanentes de segurança operacional

- Não apagar pacientes, prontuários, receitas, pagamentos ou jornadas reais.
- Limpeza de testes deve preferir filtro/ocultação segura e critérios conhecidos.
- Não sobrescrever alterações locais ou arquivos do usuário fora do escopo.
- Não incluir tokens, chaves, credenciais ou dados pessoais nesta memória.
- Preservar arquitetura e funcionalidades atuais; mudanças amplas exigem pedido.

## 5. Arquitetura de filas e suporte

Existem três conceitos distintos:

1. **Atendimento clínico:** percorre triagem, fila médica, avaliação, prescrição
   e entrega. Entra nas colunas clínicas, Relação de Pacientes, financeiro e
   indicadores clínicos conforme seu estado.
2. **Ticket de suporte geral:** identificado por `queue_type: support`,
   `whatsapp_support: true` ou `condicao: suporte_whatsapp`. Não é atendimento
   médico e não pode entrar em Aprovados, Rejeitados, Relação de Pacientes,
   financeiro, total ou indicadores clínicos. Aparece apenas na fila própria.
3. **Suporte médico (`medical_support`):** atendimento clínico real encaminhado
   temporariamente para orientação médica. Não confundir com ticket de suporte
   geral e preservar o fluxo de retorno ao administrativo.

O `pagamento_status: CONFIRMADO` usado tecnicamente em ticket de suporte não
representa receita e nunca deve ser somado ao financeiro clínico.

## 6. Indicadores de tempo do Painel Administrativo

Ativos e conectados a timestamps reais:

- **Triagem clínica:** resposta ao botão/choice "Vamos começar"
  (`triagem_iniciada_em`) até a criação do atendimento pelo webhook do n8n.
- **Espera médica:** entrada na fila até início do atendimento médico.
- **Avaliação médica:** início do atendimento até aprovação ou reprovação.
- **Emissão da receita:** aprovação/início da emissão até entrega da receita.
- **Jornada completa:** primeira mensagem (`primeiro_oi_em`) até o envio da
  receita com link e opção 3 (`entrega_receita.sent_at`). A pesquisa posterior
  não encerra nem integra essa métrica.

Suporte administrativo e suporte médico permanecem exibindo `—` enquanto não
houver marcadores próprios. Nunca fabricar média. A amostra do cabeçalho usa
somente jornadas completas com os marcadores exigidos e receita entregue.

## 7. Estado operacional registrado em 01/08/2026

- **Baseline visual Memed homologada pelo usuário em 03/08/2026:** o painel de
  staging no commit `beaf7a0` mantém o conteúdo incorporado reduzido a **40%**,
  sem viewport lógico de 250%, preserva as barras de rolagem externa do Doctor
  Prescreve e interna da Memed e exibe o atalho sticky **"Ir para o final ↓"**
  em todas as etapas abertas. O clique somente rola até o fim as áreas externas
  controladas pelo Doctor Prescreve; não emite, não simula clique e não
  substitui o botão nativo **"Enviar e emitir"** da Memed. Deployment
  `70371ea0-79ca-4a0a-b214-ef8f5e0aea30` concluído com `SUCCESS`; produção não
  foi alterada. Esta configuração foi aprovada visualmente nos prints e deve
  ser preservada contra regressões; qualquer alteração exige nova autorização
  e homologação visual do usuário.
- Em 02/08/2026, o Supabase oficial de produção recebeu a migração aditiva
  `create_decisoes_log_medicos`: foram criadas somente as tabelas vazias
  `decisoes_log` e `medicos`, seus índices, RLS e políticas exclusivas para
  `service_role`; nenhum dado foi removido ou reclassificado. O
  `production-readiness-check` passou integralmente após a aplicação.
- Em 02/08/2026, as variáveis Railway de produção do backend e do painel foram
  corrigidas para usar os domínios de produção, `ENVIRONMENT_NAME=production`,
  `NEXT_PUBLIC_APP_ENV=production`, `PRODUCT_PRICE=4990` e mock de entrega em
  produção desautorizado. Backend e painel foram publicados a partir da cópia
  limpa do commit `a758e28`: backend no deployment
  `24ecffcc-dd34-4b70-8c5c-1197dd07820c` e painel no deployment
  `da55ea3e-66b0-4c40-a580-3557bfab49ef`, ambos `SUCCESS`. Health/readiness,
  proxy do painel e observação inicial sem erros de runtime/HTTP 5xx foram
  confirmados após o deploy.

- Filtro de testes automáticos aplicado ao painel sem apagar registros do banco.
- Tickets de suporte geral separados do universo clínico e do financeiro.
- Relação de Pacientes e a jornada individual (`admin/paciente/[id]`) usam o
  mesmo `MedicalPanelHeader` operacional do Dashboard (subtitle, logo,
  identificação do admin, indicador de conexão, SAIR e retorno para "Relação
  de Pacientes"). `medicoResponsavel()` (`admin.service.ts`) é usado nas duas
  telas — nunca exibir `medico_id`/UUID bruto.
- Recuperação pontual do Painel Administrativo v2 (`16e606c`), só os trechos
  comprovadamente perdidos, em `41486c1` (dados/helpers) e `812bf8f` (visual):
  `numero_curto` volta a ser repassado por `appointment-mapper.js` e
  `atendimentos.store.js` (painel mostra `DP-XXXX`, não `#xxxxxxxx`);
  `isVisibleInMedicalPanel` volta a excluir `queue_type: medical_support` da
  fila médica normal; prop `subtitle` restaurada em `MedicalPanelHeader`;
  bloco `.admin-dashboard*` restaurado em `globals.css`; `admin/page.tsx`
  renomeado de "Painel Master" para "Painel de Monitoramento". Todo o resto
  desses 16 arquivos (Suporte Médico, MedicalSupportBand, prontuário
  consultMode, tempos/financeiro) já estava em versão mais recente que
  `16e606c` e não foi tocado. Build/type-check e validação isolada do mapper
  de `numero_curto` confirmados contra dados reais de staging (18/18
  atendimentos com `numero_curto`); confirmação visual em navegador segue
  pendente (extensão Chrome indisponível nesta máquina).
- No staging, após a separação informada: 18 atendimentos clínicos totais e 12
  pagos; confirmar novamente no ambiente antes de usar esses números no futuro.
- Triagem e jornada completa podem aparecer como `—` em registros antigos sem
  marcadores; isso não significa que os indicadores estejam desligados.
- Normalização dos indicadores e das pendências administrativas preparada em
  `5b2f843` (backend) e `06cf593` (painel): clique em "Atender" não grava mais
  uma aprovação falsa; avaliação usa as transições reais para
  `em_atendimento` e `approved/rejected`; médias positivas abaixo de um minuto
  exibem `< 1 min`; Pendências Administrativas inclui pagamento não confirmado,
  upload de receita anterior pendente e observações não resolvidas. O estado
  "Receita anterior: Recebida" exige evidência de arquivo/upload concluído,
  não apenas a declaração `previous_prescription=true`.
- Nos 18 atendimentos clínicos atuais do staging há 1 pendência administrativa
  paga aguardando upload, 11 envios de receita registrados e avaliação média
  real de 22,3 segundos. Os 18 registros históricos não têm
  `primeiro_oi_em`/`triagem_iniciada_em`; nenhum backfill foi aplicado porque
  o banco não contém uma fonte exata para esses dois instantes históricos.
- `medicoResponsavel()` mapeia identificadores técnicos conhecidos de login
  (ex.: `dr_max_vinicius_001`, `drmax.matos`) para o nome de exibição
  ("Dr. Max Matos") só na apresentação — `clinical_audit.approvedBy/rejectedBy`
  continua gravando o identificador técnico sem alteração. Se um novo médico
  for cadastrado com identificador diferente, adicionar o mapeamento em
  `admin.service.ts` (`KNOWN_DOCTOR_DISPLAY_NAMES`).
- `.panel-header--operational` usa colunas `auto minmax(0,1fr) auto` (não mais
  3 colunas iguais) para o título (nome do paciente na Jornada) não colidir
  com o botão à direita em nomes longos; título permite quebra de linha sem
  truncar. Escopado à variante operacional — não afeta o header do Painel
  Médico (`fila/page.tsx`).
- Amostra do cabeçalho de indicadores (`data.tempos.amostra`) agora sempre
  aparece, inclusive `0` — antes ficava oculta quando zero (checagem por
  valor truthy tratava `0` como ausente).
- Preço definido para novas cobranças do Doctor Prescreve em 01/08/2026:
  **R$ 49,90 por consulta**. Pagamentos históricos preservam o valor efetivamente
  cobrado; indicadores futuros usam o valor vigente centralizado no backend.
- Números clínicos históricos confirmados na fonte (não só na UI) em 01/08/2026: 18
  atendimentos clínicos (11 aprovados, 6 rejeitados, 1 aguardando receita
  anterior — soma bate), 12 pagos, então cobrados a R$ 69,90/consulta,
  R$ 838,80 confirmado (12 × 69,90 = 838,80). `amostra_por_indicador`: espera_medica/avaliacao/
  emissao_receita = 11, triagem/jornada_completa = 0 (nenhum atendimento
  atual tem os dois marcadores de jornada completos ainda). Nenhum valor é
  hardcoded — tudo calculado a partir do conjunto já filtrado (sem teste,
  sem suporte).

## 8. Typebot de produção

- Em 02/08/2026, o Typebot público `doctor-prescreve-8rmljgu` foi corrigido e
  republicado no mesmo identificador. O fluxo usa os webhooks de produção,
  mantém a rota manual segura após o CEP, normaliza as condições clínicas
  digitadas como `1` a `4` e cobra R$ 49,90 em BRL.
- O bloco de pagamento usa a conexão Stripe `Doctor Prescreve Plataforma`.
  O teste público completo, sem cartão e sem cobrança, chegou ao `payment input`
  com HTTP 200 após o aceite dos termos. Não trocar a credencial pela conexão
  antiga `Doctor Prescreve`, que causava HTTP 500 ao inicializar o pagamento.
- Os três blocos de auditoria adicionados ao grupo de aceite dos termos foram
  removidos porque impediam a transição; os aceites continuam registrados pelas
  variáveis de consentimento e pelo resultado/timestamp nativo do Typebot.
- Em 02/08/2026, o backend de produção passou a normalizar os códigos de condição
  clínica exibidos pelo Typebot (`1` hipertensão, `2` diabetes tipo 2, `3`
  dislipidemia e `4` hipotireoidismo). O deploy `9a9af6ff-af94-45c0-85a6-c6825371b703`
  publicou o commit `7da22b0`; os testes de elegibilidade e roteamento passaram.
- Durante a espera pela receita anterior, a opção de suporte é **2**. A opção
  **3** só aparece depois da emissão e entrega da receita médica. Um atendimento
  pago afetado pela falha de normalização foi recuperado de forma pontual após
  confirmação do PaymentIntent no Stripe, sem nova cobrança, e voltou para
  `awaiting_prescription_upload` com contexto de upload válido.
- O teste financeiro real de 02/08/2026 confirmou uma cobrança e um único
  estorno integral de R$ 49,90 no Stripe (`succeeded`) após reprovação médica.
  Porém, o primeiro disparo automático não encontrou o pagamento porque o
  PaymentIntent criado pelo bloco Stripe nativo do Typebot não permaneceu
  vinculado ao atendimento. O estorno foi recuperado de modo idempotente após
  verificação direta do PaymentIntent e persistência do vínculo.
- **RESOLVIDO em 02/08/2026** (mesmo dia, correção estrutural — não mais uma
  recuperação manual): o PaymentIntent do bloco nativo do Typebot (credencial
  `Doctor Prescreve Plataforma`) foi consultado direto na Stripe real e
  confirmado: `metadata` sempre `{}` e `shipping` sempre `null` — o único
  campo do paciente que sobrevive nesse PaymentIntent é `receipt_email`
  (`additionalInformation.email` do bloco). `stripe-webhook.service.js`
  (`linkOrRecordNativeTypebotPayment`) agora trata `payment_intent.succeeded`
  sem `metadata.atendimento_id`/`client_reference_id` e com valor/moeda da
  cobrança oficial (R$ 49,90 BRL) como candidato desse bloco: vincula direto
  se já existir um atendimento recente com o mesmo e-mail sem
  `stripe_payment`, ou grava um `payments` "órfão" (`appointment_id` nulo,
  já suportado pela tabela) para `processTriagemWebhook`
  (`triagem-webhook.service.js`) consumir no instante em que cria o
  atendimento — grava `dados_clinicos.stripe_payment.payment_intent` e
  vincula o `payments.appointment_id`, nos dois sentidos de ordem (webhook
  antes ou depois da criação do atendimento). Isso é o que
  `resolvePaymentIntentId` (`stripe-refund.service.js`) já lia como
  candidato de maior prioridade — nenhuma mudança foi necessária ali. Não
  depende mais de recuperação manual. Upload de receita pelo WhatsApp não
  apaga esse vínculo (`completeExternalPrescriptionUpload` sempre parte do
  `dados_clinicos` atual e só acrescenta campos). Coberto por
  `scripts/test-stripe-native-payment-link.js` (8 cenários offline, sem
  Stripe/Supabase reais: órfão antes do atendimento, reentrega idempotente
  do evento, consumo pelo e-mail com normalização de maiúsculas, prova de
  que o estorno resolve o payment_intent sem chamar a Stripe, ordem inversa
  sem deixar órfão preservando motivo/médico, nunca intercepta pagamento já
  vinculado ao painel/Memed, ignora valor/moeda fora da cobrança oficial,
  e-mail ausente não derruba o webhook); suíte de regressão existente
  (`test-triagem-payment-sync.js`, `test-stripe-webhook-refund-
  reconciliation.js`, `test-clinical-decision-approve-reject.js`,
  `test-stripe-refund-checkout-session-resolution.js`, `test-typebot-
  payment-pix-checkout-session.js`) confirmada sem regressão. Alteração
  commitada em `22f1901` na branch `codex/release-production-20260802` e
  enviada ao GitHub (`git push`, sem merge em `main`). Publicada no serviço
  `mdoctor-backend-staging` (deployment `a8e108cf-f625-4c97-96b5-892d4080ba97`,
  `SUCCESS`).
- **AINDA NÃO VALIDADO organicamente (confirmado em auditoria de 03/08/2026):**
  o atendimento usado para testar o ciclo completo pagamento→reprovação→estorno
  em 03/08 (`67664d14-57e7-408e-9839-83702f43019e`, nº 1055) **não exercitou**
  o código do `22f1901`. `dados_clinicos.stripe_payment` desse atendimento tem
  `source: "stripe_verified_manual_reconciliation"` e `payment_sync_source:
  null` (não é o formato gravado por `linkOrRecordNativeTypebotPayment`/
  `resolvePendingNativeTypebotPayment`) e `payments.appointment_id` não tem
  nenhuma linha — a criação do atendimento veio de uma reconciliação manual
  avulsa (`correlationId: "recovery2-pi_..."`, script não encontrado versionado
  em `scripts/`), não do fluxo orgânico `processTriagemWebhook`. O que
  funcionou automaticamente foi só a leitura por `resolvePaymentIntentId`
  (código que já existia, não alterado pelo `22f1901`). **Antes de promover
  para produção, falta um teste orgânico completo** (pagamento real → Typebot
  cria o atendimento sozinho → reprovação pelo painel) que prove o vínculo
  automático de ponta a ponta, sem reconciliação manual em nenhuma etapa. A
  chave Stripe permanece live e sem separação entre teste e produção.

## 9. Canais de WhatsApp protegidos

- O número da automação usa Meta Cloud API.
- O canal manual não deve ser cadastrado em Cloud API, webhook, Typebot ou n8n.
- Não alterar automação, números, provider ou webhook sem pedido específico.
- Em 02/08/2026, a sobrescrita de callback da WABA oficial foi corrigida para
  `https://web-production-5f178.up.railway.app/api/whatsapp/webhook`. O guard
  do commit `af6bf49` (`whatsapp.routes.js`) só confirma o webhook, sem
  reivindicar message_id/persistir sessão/responder, quando
  `WHATSAPP_ENABLED !== 'true'` no ambiente — o código nunca mudou desde então.
- **Estado invertido em 03/08/2026, só por variável Railway (sem commit):**
  hoje é **staging com `WHATSAPP_ENABLED=true`** (único ambiente que processa
  de fato — confirmado por `WhatsApp business message received` e
  `whatsapp_business_prescription_media_handled` nos logs) e **produção com
  `WHATSAPP_ENABLED=false`** (confirmado pelo log repetido
  `whatsapp_business_webhook_skipped_disabled` no deployment atual de
  produção, `81275428-b006-41b7-9e36-61f811746185`). Isso funciona porque os
  dois ambientes compartilham hoje **as mesmas credenciais Meta**:
  `WHATSAPP_APP_ID`, `WHATSAPP_PHONE_NUMBER_ID` (`1117281621479089`, número
  +55 11 94570-4946), `WHATSAPP_BUSINESS_ACCOUNT_ID` e `WHATSAPP_ACCESS_TOKEN`
  são idênticos em staging e produção — não há dois números/identidades
  distintas, é o mesmo evento chegando aos dois backends e só um dos dois
  processando. Uma tentativa de filtrar por `phone_number_id` do evento foi
  descartada (03/08) por não isolar nada, já que o valor é igual nos dois
  ambientes — enquanto isso não mudar, **staging como receptor único depende
  inteiramente dessa variável**, não de arquitetura separada. Antes de
  promover para produção, decidir formalmente qual backend é o dono do
  webhook (identidade Meta separada por ambiente, ou processo manual de
  alternância documentado).
- **Incidente da chave Stripe expirada (03/08/2026):** durante o teste do
  atendimento nº 1055 (`67664d14`), a reprovação médica às 04:44:55 chamou o
  estorno automático e ele falhou (`refund_failed`, `error_code:
  api_key_expired`, "Expired API Key provided") — a `STRIPE_SECRET_KEY` de
  staging vigente até então estava expirada/revogada. O atendimento caiu para
  `pendencia_pagamento.status = pendente_analise_administrativa` (comportamento
  correto: reprovação clínica não foi desfeita). A chave foi trocada no
  Railway (staging passou a usar a mesma chave live de produção — sem
  separação teste/produção, pendência já conhecida) e o estorno foi refeito
  **manualmente** às 04:47:30 (`correlationId: "retry-valid-stripe-key-
  67664d14"`, `attempt: 2`, `succeeded`). Não houve retry automático — foi
  uma segunda chamada manual depois da correção da chave.
- **Divergência `patients.phone` × `appointments.patient_phone` (encontrada e
  ainda não corrigida em 03/08/2026):** o registro de paciente
  `8bc781ca-a838-4b88-8273-2a09fb5f88a4` (reaproveitado pelos atendimentos
  nº 1052 e nº 1055, mesma pessoa) tem `patients.phone = "+5511991154773"`
  (errado), enquanto `appointments.patient_phone` dos dois atendimentos
  mostra corretamente `5511945328724`. A tabela `patients` nunca foi
  corrigida; o campo errado continua lá e pode ser reaproveitado por
  `findOrCreatePatient` em atendimentos futuros da mesma pessoa.
- Upload de receita anterior exige coincidência entre o telefone do atendimento,
  a sessão remetente e o pagamento confirmado na metadata da sessão. Em uma
  recuperação pontual autorizada, esses vínculos foram reconciliados a partir
  do PaymentIntent confirmado; a foto foi armazenada e o atendimento seguiu
  para `waiting`, elegível, pago e na fila médica. Durante essa etapa, suporte
  continua sendo a opção 2; opção 3 somente após entrega da receita emitida.

## 10. Configuração Stripe — estado auditado em 07/08/2026

- **Endpoint de produção ativo:** `we_1U1kTXJhkU05FJjngMiVSuNu` — URL
  `https://web-production-5f178.up.railway.app/api/webhooks/stripe` —
  `livemode: true` — `status: enabled` — 6 eventos:
  `checkout.session.completed`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `refund.created`, `refund.failed`,
  `refund.updated`. Criado em 07/08/2026.
- **Endpoint de staging ativo:** `we_1TtizWJhkU05FJjnLP3kmcEI` — URL
  `https://mdoctor-backend-staging-staging.up.railway.app/api/webhooks/stripe`
  — `livemode: true` — `status: enabled` — mesmos 6 eventos. Descrição:
  "Webhook Stripe do ambiente de homologação do Doctor Prescreve."
- **Nenhum terceiro endpoint LIVE ativo.** Total de endpoints `enabled`: 2,
  cada um em URL de ambiente diferente.
- **Endpoints antigos removidos:** `we_1U1hnAJhkU05FJjn0IAOODnE` (versão
  anterior de produção, mesma URL) e `we_1TQgW8JhkU05FJjnS7no4vve`
  (`medico-prescreve-backend-production...`, antigo) foram deletados.
- **`STRIPE_WEBHOOK_SECRET` presente** em Railway produção (serviço `web`,
  env `production`) e Railway staging (serviço `mdoctor-backend-staging`,
  env `staging`). Valores redactados — correspondência exata com o endpoint
  Stripe só será confirmada por uma entrega real com HTTP 2xx.
- **`/readyz` staging:** HTTP 200, `failures: []`, `stripe_webhook_secret: ok`.
  Único warning: `node_env` (`NODE_ENV` ≠ `production` em staging) — esperado.
  Sem erros de assinatura/webhook nos logs.
- **Risco conhecido (estrutural, pré-existente):** ambos os endpoints são
  `livemode: true`. Staging usa a mesma `sk_live_*` de produção. Um evento
  Stripe real (ex.: `checkout.session.completed`) é entregue simultaneamente
  aos dois backends, mas o Stripe entrega e assina separadamente o mesmo
  evento LIVE para cada endpoint ativo; portanto produção e staging podem
  aceitar e processar suas respectivas cópias do mesmo evento. Os signing
  secrets distintos apenas autenticam cada entrega e não impedem processamento
  duplicado entre ambientes.
  Qualquer fluxo completo de teste em staging com o Typebot gera cobrança real.

## 11. WhatsApp — Menu, Suporte e Sinais de Alerta — baseline confirmado em 19/08/2026

- **Repositório e branches (normalizado em 21/08/2026):** repositório oficial
  `MMax-Company/Plataforma-Medica-Mdoctor`. `main` é a única referência de
  produção e `staging` é a única referência de homologação. A divergência com
  `codex/release-production-20260802` foi reconciliada preservando exatamente
  a árvore funcional; a branch antiga foi removida depois da criação dos
  backups.
- **Estado de produção confirmado em 21/08/2026:** Railway
  `Backend-Mdoctor` → serviço `web`, ambiente `production`, branch `main`,
  deployment `1f5774c8-6b3a-4363-8996-4bbf85d489ac`, commit `30c5742`,
  `SUCCESS`; Railway `Painel-MDoctor` → serviço `Painel Medico`, ambiente
  `production`, branch `main`, deployment
  `3796f02a-113d-4bb8-a995-bb81985d8d87`, mesmo commit, `SUCCESS`.
  O estado de WhatsApp/Meta descrito nos itens seguintes foi confirmado em
  19/08/2026 e deve ser verificado novamente antes de qualquer mudança nesse
  canal.
- **Menu inicial — arquitetura confirmada:** saudação ("Oi" etc.) é
  controlada pelo Backend, sempre reapresenta o menu (1 = iniciar
  atendimento/`typebot_clean`, 2 = suporte) e grava
  `whatsapp_menu_state = awaiting_menu_choice`. Enquanto esse estado está
  ativo, a próxima escolha 1/2 pertence ao menu com prioridade sobre
  qualquer ticket de suporte antigo ou sessão Typebot ativa/travada. Fora
  dessa janela, sessão Typebot clínica ativa é dona normal das respostas
  1/2/3.
- **Dois conflitos de prioridade já corrigidos e confirmados em produção**
  (`mdoctor-backend/src/services/whatsapp-support.service.js`):
  - Commit `7a94d2bd8725b0edace4beb621e429416f43371f` — "prioriza menu
    sobre suporte antigo": bloco `MENU_STATE_AWAITING_CHOICE` verificado
    antes da checagem de `support_sub_status`/rejeição antiga. Confirmado
    no código e em log real de produção (19/08 08:53 UTC): "1" com
    `previousMenuState=awaiting_menu_choice` corretamente virou
    `typebot_clean`/`startChat`, apesar de existir um ticket de suporte
    antigo aberto no mesmo telefone.
  - Commit `ae3bda417e566c6c4876a967fac23aea794592f6` — ajuste da
    apresentação dos Sinais de Alerta.
- **Sinais de Alerta — apresentação confirmada** (`ALERT_SIGN_PRESENTATION`
  em `typebot-whatsapp.bridge.js`, commit `ae3bda4`, em produção): título +
  descrição por sinal — Precordialgia, Dispneia, Alteração da consciência,
  Déficit neurológico, Hemorragia, Síndrome febril, Crise hipertensiva,
  Disglicemia sintomática, Sintoma agudo grave, Sem sinais de alarme.
  **Pendente de conferência:** os `values` (chaves internas do mapa,
  copiados manualmente no Typebot) não foram corrigidos nesta rodada e
  podem estar associados à opção errada — não verificado diretamente contra
  o Typebot publicado nesta sessão (sem acesso à API/admin do Typebot).
- **Critérios de Elegibilidade — só o que está confirmado:** regra
  conhecida de que existe **uma única pergunta de confirmação final**, sem
  reconstrução/repetição em segunda mensagem (consistente com o código do
  bridge, que só emite um bloco de choice input por resposta). **Fidelidade
  completa ao Typebot publicado (texto, negrito, espaçamento, quebras de
  linha, emojis, ordem, pontuação) está PENDENTE DE CONFERÊNCIA** — não foi
  comparada nesta sessão por falta de acesso direto ao Typebot publicado.
- **GAP ABERTO — PENDENTE / NÃO CORRIGIDO (identificado em 19/08/2026):**
  quando existe uma sessão Typebot clínica ativa e válida
  (`typebot_session_id` + `expected_input_id`/fluxo ativo), um ticket de
  suporte antigo em `waiting` ou `em_atendimento` **não pode** sequestrar as
  respostas destinadas ao Typebot — mas hoje sequestra, porque em
  `resolveMetaInboundRouting` a checagem de `support_sub_status` tem
  prioridade incondicional e ocorre antes da checagem de fluxo Typebot
  ativo (`isActiveTypebotFlow`/`diagActiveFlow`). Reproduzido em produção:
  telefone com ticket de suporte `appointments.id =
  33c77460-fcd5-4e62-afe1-13d3a9a270e9` (aberto em 11/08/2026,
  `support_sub_status=em_atendimento`, nunca finalizado) fez o cenário
  `Oi → 1 → startChat → "Vamos começar" → continueChat` parar exatamente no
  `continueChat`: o Typebot deu `startChat` com sucesso (`sessionId
  tc261ys43cduvnepk340t6lp`, aguardando input
  `sbjZWLJGVkHAkDqS4JQeGow`/"Vamos começar"), mas a resposta real do
  paciente ao clicar "Vamos começar" (19/08 08:53:47 UTC) foi interceptada
  pelo ticket antigo e respondida com a mensagem de espera do suporte, sem
  chamar o Typebot. **Nenhuma correção foi aplicada — autorização
  pendente.**
- **Falha transitória Meta (ECONNRESET/fetch failed) pós-avanço de
  cursor — diagnóstico anterior preservado, ainda sem correção:** o cursor
  do Typebot pode avançar e persistir antes de confirmar a entrega da
  resposta à Meta; não existe retry equivalente ao que já existe para
  chamadas ao Typebot. Não reproduzida no teste de 19/08 — a parada desse
  teste teve causa diferente (gap de suporte antigo acima), sem nenhum erro
  de rede nos logs.

## 12. Normalização de repositório, CI e produção — 21/08/2026

- A produção foi preservada antes da reconciliação por meio das branches
  `backup/backend-prod-20260821`, `backup/painel-prod-20260821` e
  `backup/producao-pre-deploy-20260728-branch`. Revisar a necessidade dessas
  referências até 04/09/2026; não excluir antes de confirmar uma release/tag
  recuperável.
- As seis branches remanescentes foram comparadas. Mudanças seguras do painel
  foram consolidadas no PR #44. O histórico divergente de `main` foi
  reconciliado no PR #45 sem alterar a árvore funcional. O PR antigo #43 foi
  revisado e encerrado por ter sido substituído pela normalização.
- Branches temporárias/antigas removidas após a consolidação:
  `staging/cep-retry-20260821`, `chore/normalize-main-20260821`,
  `chore/reconcile-main-history-20260821`,
  `codex/fix-painel-admin-visual-20260808`,
  `codex/release-production-20260802` e
  `fix/cep-upload-prescription-20260728`.
- Branches oficiais protegidas no GitHub:
  - `main`: produção; Pull Request obrigatório.
  - `staging`: homologação; Pull Request obrigatório.
  - ambas exigem histórico linear, resolução de conversas e checks atualizados;
    force-push e exclusão estão bloqueados, inclusive para administradores.
- Workflow `.github/workflows/ci.yml` criado e validado. Checks obrigatórios:
  `Repository safety`, `Backend check` e `Panel lint and build`. A checagem de
  segurança considera somente arquivos e linhas novas para não bloquear o
  projeto por falsos positivos históricos. O backend executa `npm ci` e
  verificação de sintaxe; o painel executa lint e build no Node 20, com npm
  10.9.4 e reconciliação de dependências compatível com o runner Linux.
- O lint do painel referenciava regras `@typescript-eslint` sem carregar o
  plugin. O pacote oficial `typescript-eslint` foi incluído como dependência de
  desenvolvimento e registrado no flat config. Resultado atual: zero erros e
  seis avisos antigos de dependências de hooks; o build do Next.js passa.
- O documento `docs/ESTADO-ATUAL-PRODUCAO.md` foi criado com branches, URLs,
  estratégia de promoção, validações e referências de segurança.
- PR #46 promoveu documentação e CI primeiro para `staging`. Homologação:
  backend deployment `389cb627-90eb-4282-a7d6-bb9208af22c6` e painel
  deployment `bb8ef43d-1067-4975-bae0-ff4d8614d8e2`, commit `13a1d5f`, ambos
  `SUCCESS`. CI pós-merge também aprovado.
- PR #47 promoveu `staging` para `main` por rebase autorizado. Produção:
  backend deployment `1f5774c8-6b3a-4363-8996-4bbf85d489ac` e painel
  deployment `3796f02a-113d-4bb8-a995-bb81985d8d87`, commit `30c5742`, ambos
  `SUCCESS`.
- Validação funcional final de staging e produção: `/health` OK; `/readyz`
  sem falhas (produção também sem avisos); Supabase conectado; persistência
  ativa; Memed real em `production`, sem fallback mock; login, fila e dashboard
  HTTP 200; `auth_login` e `auth_me` aprovados; API retornou 18 atendimentos.
  Em staging, o único aviso foi `NODE_ENV` diferente de `production`, esperado.
- Railway final: backend/painel de staging acompanham `staging`; backend/painel
  de produção acompanham `main`; nenhum serviço está preso a um `commitSha`.
  Variáveis, domínios e demais configurações foram preservados.
- Pendências técnicas separadas desta normalização: seis avisos de hooks no
  painel e vulnerabilidades npm reportadas pelas instalações. Não executar
  `npm audit fix --force` nem atualizações amplas sem análise e autorização.

## 13. Manutenção desta memória

Atualizar este arquivo no mesmo trabalho quando mudar:

- decisão permanente de negócio;
- arquitetura de filas, integrações ou dados;
- ambiente/branch ativa ou regra de deploy;
- funcionalidade homologada ou limitação operacional relevante.

Registrar somente o estado final confirmado, com data e commit quando houver.
Remover fatos superados em vez de acumular versões contraditórias. A memória não
substitui a verificação do código, banco, Git e ambiente atual.
