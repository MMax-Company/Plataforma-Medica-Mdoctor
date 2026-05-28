# Typebot Staging Hardening - Doctor Prescreve

Data/hora: 2026-05-28 08:57 -03:00

## Arquivo auditado

- `docs/typebot/typebot-export-doctor-prescreve-8rmljgu (5).json`

## Achados de producao e hardcoded

- Webhook de producao encontrado:
  - `https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook`
- Referencia de bloco de pagamento encontrada:
  - `payment input` com `credentialsId: cmmntjz0w000304jpawo0m0ss`
- URL institucional LGPD encontrada:
  - `https://www.doctorprescreve.com.br/lgpd/consentimento.pdf`
- Referencias de backend Railway producao no webhook: `1`
- Referencias explicitas a Stripe no JSON exportado: `0`
- Tokens/API keys/bearer hardcoded no JSON exportado: `0`

## Versao staging-safe criada

- `docs/typebot/typebot-doctor-prescreve-staging-safe.json`

Alteracao aplicada:

- Webhook trocado de producao para staging:
  - de: `https://n8n-node-production-f844.up.railway.app/webhook/typebot-webhook`
  - para: `https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook`

## Validacao integrada (2026-05-28)

E2E dry-run Typebot -> n8n -> backend confirmou:

- webhook staging-safe correto (`typebot-webhook` no n8n staging)
- sem webhook production no arquivo staging-safe
- payment block preservado

Referencia: `docs/E2E-TYPEBOT-N8N-EVOLUTION-STAGING.md`

Preservado:

- Fluxo clinico
- Blocos de LGPD e elegibilidade
- Estrutura de grupos/blocos/arestas
- Bloco de pagamento (sem alteracao)

## Ajustes funcionais aplicados no staging-safe

### Data de nascimento

- Campo de data de nascimento ajustado para orientacao explicita:
  - formato aceito no Typebot: `dd/mm/aaaa`
  - placeholder atualizado com exemplo real
  - mensagem de retry para formato invalido
  - `inputMode` ajustado para `text` (evita bloquear `/`)
- Normalizacao esperada no n8n/webhook:
  - entrada valida `dd/mm/aaaa` -> normalizar para `yyyy-mm-dd`
  - entrada vazia/invalida -> nao enviar data normalizada (usar `null`/ausente)

### Textos revisados

- LGPD/consentimento com linguagem mais coerente e objetiva
- Confirmacao de dados revisada
- Elegibilidade revisada
- Sinais de alerta revisados
- Mensagens finais revisadas para clareza e seguranca

### Placeholders seguros de documentos

- Inseridos placeholders de documentos no fluxo:
  - `SUPABASE_PUBLIC_LGPD_URL`
  - `SUPABASE_PUBLIC_TELEMEDICINA_TERMO_URL`
  - `SUPABASE_PUBLIC_PRIVACIDADE_URL`
  - `SUPABASE_PUBLIC_CONSENTIMENTO_URL`
  - `SUPABASE_PUBLIC_ORIENTACAO_PACIENTE_URL`

## Seguranca e LGPD

- Consentimento LGPD permanece antes da coleta de dados sensiveis.
- Coleta de CPF e dados pessoais permanece no fluxo original (sem bypass criado).
- Payload de webhook contem dados clinicos e pessoais necessarios ao fluxo; manter principio de minimizacao na evolucao futura.
- Nenhum secret novo foi introduzido no arquivo staging-safe.

## Payment block

- Bloco de pagamento identificado e mantido sem alteracao por seguranca operacional e requisito de nao alterar pagamento sem confirmacao explicita.
- Risco: `credentialsId` pode estar associado a ambiente produtivo no Typebot runtime.
- Recomendacao: criar credencial de pagamento exclusiva para staging antes de qualquer ativacao de pagamento em staging.

## Validacao executada

- JSON parseavel: `OK`
- Sem webhook de producao no arquivo staging-safe: `OK`
- Webhook staging presente no arquivo staging-safe: `OK`
- Fluxo preservado/importavel: `OK` (estrutura JSON valida)

## Riscos restantes

- `credentialsId` do bloco de pagamento ainda aponta para identificador existente, sem garantia de ser staging.
- URL institucional de LGPD continua em dominio oficial (informativa, nao webhook de execucao).
- Coleta de CPF requer controles operacionais no runtime (acesso, retencao, auditoria) fora do escopo deste patch.

## Conclusao

- Staging separado de producao no webhook principal do Typebot: `sim`.
- Producao ativa nao foi alterada.
