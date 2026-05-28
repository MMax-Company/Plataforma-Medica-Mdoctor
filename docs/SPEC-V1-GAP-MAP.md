# Doctor Prescreve SPEC V1 - Gap Map

Este mapa separa o que ja esta implementado do que ainda bloqueia o produto completo do SPEC V1.

## Status atual

- Backend operacional: 85-90%
- Automation operacional: 90-93%
- Painel medico/admin: 75-82%
- Produto completo SPEC V1: 65-72%

## Leitura executiva

O Mdoctor Survive esta alinhado com a ideia original de telemedicina assincrona: triagem, fila medica, painel operacional, Memed, automacao e entrega. O estado correto e MVP avancado com base real de producao, ainda dependente de validacoes externas e credenciais reais para fechar 100%.

O Spec V1 do Master Panel deve ser tratado como base inicial do painel, nao como escopo total do produto. A visao consolidada esta em `docs/VISAO-UNIFICADA-MDOCTOR-SURVIVE.md`.

## Ja alinhado ao SPEC

- Backend modular em Express.
- JWT para painel medico e master/admin.
- Readiness de producao em `/readyz`.
- Healthcheck em `/health` e `/healthz`.
- Fluxo de atendimentos com fila, revisao medica, Memed, validacao e entrega.
- Status canonicos do SPEC:
  - `TRIAGED`
  - `QUEUE`
  - `UNDER_REVIEW`
  - `MEMED_PROCESSING`
  - `AWAITING_VALIDATION`
  - `VALIDATED`
  - `DELIVERED`
  - `FINISHED`
  - `REJECTED`
- Aliases legados preservados para dados antigos:
  - `FILA`
  - `EM_ATENDIMENTO`
  - `APROVADO`
  - `RECUSADO`
  - `RECEITA_EMITIDA`
- Memed embedded iniciado no painel.
- Auditoria de decisoes medicas.
- Entrega por WhatsApp/SMS/e-mail via providers reais quando configurados.
- Rate limit, CORS restrito, Helmet e logs estruturados no backend.
- Painel operacional em Next.js separado do backend.
- Producao nao deve cair em fallback local quando Supabase falhar.
- Metadados de receita Memed persistidos em tabela dedicada `receitas_memed`.

## Observacoes sobre auditorias externas

Algumas analises antigas citam HTML inline do painel dentro de `server.js`. Isso nao corresponde ao estado atual deste repo: o painel esta em `mdoctor-panel`, e o `mdoctor-backend/server.js` apenas monta APIs.

Tambem nao considerar Stripe ou AES como prontos nesta versao sem confirmar implementacao real no codigo atual.

O servico `mdoctor-automation` cobre a camada de orquestracao por webhooks e encaminhamento. Quando o texto mencionar N8N como "cerebro", tratar como visao arquitetural/operacional, nao como garantia de todos os fluxos completos ja em producao.

## Gaps para SPEC 100%

1. Infra real
   - Dominios publicos.
   - SSL.
   - Deploy estavel.
   - Variaveis reais no provedor.
   - Webhooks publicos validados.

2. Supabase/RLS
   - Confirmar schema atualizado aplicado em producao.
   - Confirmar RLS em todas as tabelas expostas.
   - Validar politicas por papel/usuario.
   - Testar service role apenas no backend.

3. Memed real
   - Validar dominio liberado.
   - Validar token real.
   - Capturar prescription ID, protocolo, URL e PDF.
   - Confirmar eventos obrigatorios do embedded.
   - Teste ponta a ponta com prescritor real.

4. Painel premium
   - Criar design system compartilhado antes de expandir novas telas.
   - Refatorar login para o layout de duas colunas do Spec V1.
   - Remover tela inicial provisoria com status de localhost.
   - Padronizar botoes, cards, inputs, badges, metric cards e toasts.
   - Refinar microinteracoes.
   - Revisar responsividade mobile/tablet.
   - Validar acessibilidade basica.
   - Criar estados vazios/erro/loading mais polidos.

5. Seguranca enterprise
   - Expiracao e renovacao de sessao.
   - Logout seguro.
   - Politicas RLS auditadas.
   - Observabilidade com dashboards/log drain.
   - Backup e restore testados.

6. Pagamentos
   - Definir se Stripe continua no escopo.
   - Se sim: Checkout, webhook assinado, idempotencia e auditoria de pagamento.

## Proximo melhor passo

Executar uma fase de validacao ponta a ponta em ambiente local/producao:

1. Criar atendimento via WhatsApp/API.
2. Mover para `QUEUE`.
3. Medico assumir `UNDER_REVIEW`.
4. Abrir Memed `MEMED_PROCESSING`.
5. Capturar receita `AWAITING_VALIDATION`.
6. Aceitar receita `VALIDATED`.
7. Entregar via provider real `DELIVERED`.
8. Conferir auditoria no painel master.
