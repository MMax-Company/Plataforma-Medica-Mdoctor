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
