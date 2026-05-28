# E2E Staging Operacional - Doctor Prescreve

Data/hora: 2026-05-28 09:20 -03:00

## Escopo

Validacao operacional controlada do fluxo:

- Typebot staging-safe
- n8n staging
- backend staging
- Supabase staging
- painel staging
- prescription mock
- delivery mock

Restricoes respeitadas:

- Sem mexer em producao.
- Sem ativar Stripe real.
- Sem ativar WhatsApp real.
- Sem ativar Memed producao.
- Sem remover fallback/mock.
- Sem uso de dados reais de paciente.

## Dados ficticios usados

- Nome: `Paciente Ficticio E2E <timestamp>`
- CPF: `12345678909` (teste)
- Telefone: `+5511999887766` (teste)
- Email: `e2e.staging.<timestamp>@example.com`
- Data de nascimento: `15/08/1988`
- Condicao cronica elegivel: hipertensao/uso continuo
- Sinais de alerta: `NAO`

## Execucao e resultados

### 1) Typebot -> n8n staging

Teste:

- `POST https://n8n-staging-staging-2dfe.up.railway.app/webhook/typebot-webhook`

Resultado:

- `404` com mensagem:
  - `The requested webhook "POST typebot-webhook" is not registered.`

Leitura:

- O webhook de producao do workflow nao esta ativo/publicado no n8n staging.
- Este ponto bloqueou o trecho Typebot -> n8n no ciclo atual.

### 2) Backend staging (contrato operacional)

- `GET /health` -> `200`
- `GET /readyz` -> `200`
- `POST /api/auth/login` -> `200`

Webhook seguro com headers:

- `X-MDoctor-Webhook-Secret`
- `X-Correlation-Id`
- `Idempotency-Key`

Resultado:

- 1a chamada -> `200`, `duplicate=false`
- 2a chamada (mesma key) -> `200`, `duplicate=true`
- `correlationId` consistente nas respostas

Fluxo clinico operacional (mock controlado):

- Atendimento de continuidade criado: `201`
- `POST /api/prescriptions/:id/generate` -> `201`, `source=mock`
- `POST /api/atendimentos/:id/deliver` -> `200`, `provider=mock`, `status=delivered`
- `GET /api/prescriptions/:id` -> `200`, `source=mock`

### 3) Supabase staging

- Backend operando com storage Supabase ativo durante o ciclo.
- Registros de atendimento/prescricao mock persistidos via backend.

### 4) Painel staging

- `/login` -> `200`
- `/dashboard` -> `200`
- Sem regressao observada no ciclo.

## Diagnostico final do ciclo

- Fluxo completo ponta a ponta: **nao** (bloqueio externo no n8n webhook nao registrado).
- Fluxo operacional backend->Supabase->painel->prescription mock->delivery mock: **sim**.

## Causa do bloqueio

- Workflow/trigger de producao URL do n8n staging nao esta ativo/publicado para `typebot-webhook`.

## Correcao minima recomendada (sem codigo)

1. Abrir n8n staging.
2. Ativar/publicar o workflow que registra `POST /webhook/typebot-webhook`.
3. Repetir este mesmo ciclo E2E com dados ficticios.

## Confirmacoes de seguranca

- Nenhuma alteracao de codigo foi necessaria.
- Nenhuma alteracao em producao Railway.
- Nenhum secret commitado.
- Nenhum envio real para paciente real.
