# Protocolos Clinicos (Staging)

## Versao de protocolo

- `staging-clinical-v1`
- Perfil: **conservador**

## Condicoes elegiveis para renovacao remota

- Hipertensao arterial sistemica (HAS)
- Diabetes mellitus tipo 2 (DM2)
- Dislipidemia (DLP)
- Hipotireoidismo

## Criterios obrigatorios de elegibilidade

1. Comprovacao de uso continuo
2. Receita anterior valida
3. Tempo de uso minimo de 30 dias
4. Sem red flags
5. Sem contraindicacao basica

Se qualquer item critico estiver ausente, a renovacao remota deve ser bloqueada e o caso deve seguir para reavaliacao presencial.

## Red flags e bloqueios

- `sintomas_novos`
- `crise_clinica`
- `sinais_urgencia`
- `internacao_recente`
- `diagnostico_recente`
- `contraindicacao_basica`

## Catalogo padrao de recusa clinica

- `sinais_alarme`: indicacao de avaliacao presencial imediata.
- `consulta_presencial`: necessidade de reavaliacao presencial antes de renovar.
- `documentacao_insuficiente`: falta de receita previa/uso continuo comprovado.
- `medicacao_incompativel`: risco potencial por incompatibilidade/contraindicacao.
- `renovacao_insegura`: renovacao remota clinicamente insegura no contexto atual.

## Campos auditaveis por decisao

- `approvedBy`
- `approvedAt`
- `criteriaUsed`
- `protocolVersion`
- `mode`
- `correlationId`
- `decisionRationale`

## Regras operacionais

- Nunca converter triagem em diagnostico automatico.
- Manter textos de orientacao claros e nao robóticos.
- Preservar fallback mock quando integracoes externas nao responderem.
- Nao retornar erro bruto 502 ao medico/painel para fluxos de renovacao.

## Evidencia de validacao (2026-05-28)

Matriz de casos ficticios executada em staging:

- Elegiveis:
  - HAS
  - DM2
  - DLP
  - hipotireoidismo
- Inelegiveis:
  - sinais de alerta (`sinais_alarme`)
  - documentacao insuficiente (`documentacao_insuficiente`)
  - medicacao incompativel/contraindicacao (`medicacao_incompativel`)

Campos clinicos obrigatorios validados em todos os casos:

- `eligible`
- `reason`
- `reasonCode`
- `criteriaUsed`
- `riskLevel`
- `renewalStatus`
- `protocolVersion`

Persistencia e auditoria validadas:

- `atendimentos.dados_clinicos` com `clinical_summary`, `protocol_version`, `clinical_audit`
- `audit_logs.payload` com trilha de protocolo/criterios/correlation

Fluxo clinico operacional validado:

- aprovar elegivel
- reprovar inelegivel
- gerar receita mock
- delivery mock
- status final coerente (`delivered` para caso aprovado com entrega)
