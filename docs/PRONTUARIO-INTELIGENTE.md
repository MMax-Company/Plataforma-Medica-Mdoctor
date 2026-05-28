# Prontuario Inteligente (Staging)

## Objetivo

Elevar o prontuario de staging de um fluxo operacional para um fluxo clinico conservador, com narrativa medica mais util e rastreabilidade de decisao sem alterar contratos publicos.

## O que foi implementado

- Elegibilidade conservadora para renovacao remota de `HAS`, `DM2`, `DLP` e `hipotireoidismo`.
- Bloqueio quando faltam dados criticos de seguranca:
  - comprovacao de uso continuo
  - receita anterior valida
  - tempo de uso minimo (>= 30 dias)
  - ausencia de red flags e contraindicacoes basicas
- Campos aditivos na decisao de elegibilidade:
  - `reasonCode`
  - `riskLevel`
  - `renewalStatus`
  - `protocolVersion`
  - `criteriaUsed`
- Templates clinicos inteligentes (variantes) para:
  - queixa principal
  - historia clinica
  - exame fisico em telemedicina
  - conduta
  - orientacoes

## Rendering no painel

No prontuario medico foram adicionados/refinados:

- banner de elegibilidade com status, risco, renovacao e protocolo
- resumo clinico inicial
- timeline clinica resumida
- destaque de medicacao
- bloco de rastreabilidade clinica (modo, correlationId, aprovador, horario)
- leitura de dados clinicos persistidos no backend (`dados_clinicos` + `elegibilidade`)

## Auditoria Clinica

Persistencia duplicada em staging:

- `atendimentos.dados_clinicos.clinical_audit`
- `audit_logs.payload`

Campos de rastreio mantidos:

- `approvedBy`
- `approvedAt`
- `criteriaUsed`
- `protocolVersion`
- `mode` (`mock|real`)
- `correlationId`
- `decisionRationale`

## Garantias de seguranca de escopo

- Producao nao alterada.
- Sem mudanca de schema Supabase.
- Sem mudanca de contratos publicos de API.
- Sem alteracao de n8n/Typebot structure principal.
- Fallback/mock preservado.

## Validacao clinica E2E (staging)

Data: 2026-05-28

Validacao executada em ambiente staging real apos deploy do commit `cba26c1` no backend staging.

Resultados consolidados:

- Build/check/lint:
  - `npm --prefix mdoctor-backend run check` OK
  - `npm --prefix mdoctor-panel run lint` OK (warnings preexistentes fora do escopo)
  - `npm --prefix mdoctor-panel run build` OK
- Endpoints staging:
  - backend `/health` e `/readyz`: 200
  - backend `/api/atendimentos`: 200
  - painel `/login` e `/dashboard`: 200
- Casos clinicos ficticios validados no webhook backend staging:
  - HAS, DM2, DLP, hipotireoidismo: elegiveis (`reasonCode=eligible`, `riskLevel=BAIXO`, `renewalStatus=coerente`)
  - sinais de alerta: bloqueado (`reasonCode=sinais_alarme`)
  - documentacao insuficiente: bloqueado (`reasonCode=documentacao_insuficiente`)
  - medicacao incompativel/contraindicacao basica: bloqueado (`reasonCode=medicacao_incompativel`)
- Persistencia clinica confirmada:
  - `dados_clinicos.protocol_version=staging-clinical-v1`
  - `dados_clinicos.clinical_summary` presente
  - `dados_clinicos.clinical_audit` presente
- Auditoria Supabase confirmada:
  - `audit_logs.payload` com `protocolVersion`, `criteriaUsed` e rastros de fluxo
  - eventos observados: `webhook_processed`, `status_change`, `delivery_completed`
- Acoes operacionais:
  - aprovacao caso elegivel: OK
  - recusa caso inelegivel: OK
  - geracao Memed mock: OK
  - delivery mock: OK

Observacao operacional:

- O webhook via n8n staging respondeu em conformidade, mas sem repassar todos os campos clinicos enriquecidos do `rawMessage.original`; por isso, a matriz clinica completa foi validada diretamente no webhook backend staging com o mesmo contrato de seguranca (`X-MDoctor-Webhook-Secret`), sem alterar n8n/Typebot.
