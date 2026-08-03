# Memória Compartilhada — Doctor Prescreve

**Última atualização:** 02/08/2026  
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

- O projeto está em homologação: **staging é o ambiente padrão**.
- Painel staging: `https://painel-medico-staging-staging.up.railway.app`.
- Backend staging: `https://mdoctor-backend-staging-staging.up.railway.app`.
- Não alterar `main`, produção, serviços ou dados de produção sem autorização
  explícita do usuário na solicitação atual.
- "Faça commit e deploy" não autoriza produção por si só; usar staging enquanto
  o usuário estiver revisando o painel.
- Antes do deploy, confirmar branch e serviço Railway vinculados.
- O último deploy de staging informado em 01/08/2026 (backend + painel) foi o
  commit `051545b` na branch `fix/cep-upload-prescription-20260728`. Esse
  commit corresponde ao patch preparado pelo Codex como `1067d99`
  ("docs: registra regras finais de tempos e pendencias", em cima de
  `5b2f843`/`06cf593`) — aplicado via `git am` a partir de
  `af52f93`; o hash local difere do original só porque o committer muda a
  cada `git am` (autor `Codex <codex@openai.com>` e datas originais foram
  preservados; árvore/conteúdo idênticos, confirmado por `git apply --check`
  limpo antes de aplicar). Confirmar sincronização entre Git local, remoto e
  Railway antes do próximo trabalho.

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

- Em 03/08/2026, o painel de staging recebeu no commit `beaf7a0` o atalho
  externo sticky "Ir para o final", disponível em todas as etapas abertas da
  Memed. O clique apenas rola até o fim todas as áreas externas controladas
  pelo Doctor Prescreve; as barras externa e interna permanecem visíveis como
  alternativas manuais. O atalho não emite nem simula clique. Deployment
  `70371ea0-79ca-4a0a-b214-ef8f5e0aea30` concluído com `SUCCESS`; produção não
  foi alterada. Validação visual do fluxo completo permanece pendente.
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
  payment-pix-checkout-session.js`) confirmada sem regressão. **Pendente**:
  validação end-to-end em staging com pagamento de teste real do bloco
  nativo do Typebot (nenhum teste com Stripe/Supabase reais foi executado
  nesta correção) antes de considerar resolvido para produção.

## 9. Canais de WhatsApp protegidos

- O número da automação usa Meta Cloud API.
- O canal manual não deve ser cadastrado em Cloud API, webhook, Typebot ou n8n.
- Não alterar automação, números, provider ou webhook sem pedido específico.
- Em 02/08/2026, a sobrescrita de callback da WABA oficial foi corrigida para
  `https://web-production-5f178.up.railway.app/api/whatsapp/webhook`. O staging
  permanece inscrito na Meta por legado, mas usa `WHATSAPP_ENABLED=false` e,
  desde o commit `af6bf49`, apenas confirma o webhook sem reivindicar message_id,
  persistir sessão ou responder ao paciente. Produção usa
  `WHATSAPP_ENABLED=true` e é o único ambiente que processa o canal oficial.
- Upload de receita anterior exige coincidência entre o telefone do atendimento,
  a sessão remetente e o pagamento confirmado na metadata da sessão. Em uma
  recuperação pontual autorizada, esses vínculos foram reconciliados a partir
  do PaymentIntent confirmado; a foto foi armazenada e o atendimento seguiu
  para `waiting`, elegível, pago e na fila médica. Durante essa etapa, suporte
  continua sendo a opção 2; opção 3 somente após entrega da receita emitida.

## 10. Manutenção desta memória

Atualizar este arquivo no mesmo trabalho quando mudar:

- decisão permanente de negócio;
- arquitetura de filas, integrações ou dados;
- ambiente/branch ativa ou regra de deploy;
- funcionalidade homologada ou limitação operacional relevante.

Registrar somente o estado final confirmado, com data e commit quando houver.
Remover fatos superados em vez de acumular versões contraditórias. A memória não
substitui a verificação do código, banco, Git e ambiente atual.
