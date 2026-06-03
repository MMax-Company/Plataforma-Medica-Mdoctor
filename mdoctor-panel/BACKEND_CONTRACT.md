# Backend Contract - Mdoctor Panel

Este documento descreve os endpoints que o painel medico usa ou espera consumir.
Enquanto algum endpoint nao estiver disponivel ou a API falhar, o painel preserva fallback mockado.

## Endpoints atuais do backend local

### GET /api/atendimentos

Objetivo: listar atendimentos/pacientes para o dashboard operacional.

Payload: nenhum.

Resposta esperada: objeto com `success: true` e `atendimentos`, contendo campos como `id`, `paciente_nome`, `paciente_telefone`, `paciente_cpf`, `paciente_email`, `status`, `pagamento_status`, `condicao`, `doenca_cronica`, `medicacao_em_uso` e `dados_clinicos`.

Observacao: o painel usa fallback mockado se a API falhar ou retornar lista vazia.

Payload real validado localmente: `success: true`, `atendimentos[]`, status como `QUEUE`, risco como `BAIXO`, pagamento em `pagamento_status` e timestamps em `criado_em`/`atualizado_em`.

### GET /api/atendimentos/:id

Objetivo: buscar detalhes do atendimento. Este e o equivalente atual de prontuario/detalhes.

Payload: nenhum.

Resposta esperada: objeto com `success: true` e `atendimento`.

Observacao: substitui temporariamente o endpoint planejado `GET /api/prontuario/:id`.

Payload real validado localmente: `success: true`, `atendimento`.

### PATCH /api/atendimentos/:id/status

Objetivo: atualizar decisao/status operacional do atendimento.

Payload esperado:

```json
{
  "status": "under_review | memed_processing | ready | rejected",
  "decision": "under_review | memed_processing | ready | rejected",
  "motivo": "Atualizacao feita pelo painel medico"
}
```

Resposta esperada: objeto com `success: true`, `atendimento` e opcionalmente `decisao`.

Observacao: substitui temporariamente o endpoint planejado `POST /api/decisao/:id`.

Observacao local: endpoint protegido por autenticacao. Sem token local, retorna `401`; o painel preserva fallback/atualizacao visual otimista.

### Fluxo oficial Memed (receita)

```text
POST /api/memed/iniciar-emissao
→ painel /receita (widget Sinapse)
→ POST /api/memed/receita
→ POST /api/atendimentos/:id/clinical/validate
```

Doctor Prescreve **nao** emite, **nao** assina e **nao** manipula certificado digital. Emissao e assinatura (Bird ID) sao exclusivas do widget Memed.

### /api/prescriptions (legado — nao oficial)

```text
POST /api/prescriptions              → 410 (descontinuado)
POST /api/prescriptions/:id/generate → 410 (descontinuado)
GET  /api/prescriptions/:id            → legado (preferir GET /api/atendimentos/:id)
GET  /api/prescriptions/:id/pdf      → legado
```

O painel le receita via `GET /api/atendimentos/:id` (`dados_clinicos.memed_receita`).

### POST /api/atendimentos/:id/deliver

Objetivo: entrega de receita por canal, incluindo WhatsApp.

Payload esperado:

```json
{
  "channel": "whatsapp"
}
```

Observacao: usado como equivalente atual para futuro envio de receita por WhatsApp.

O frontend nao envia WhatsApp diretamente. Ele apenas chama o backend, que futuramente deve acionar n8n/WhatsApp API/provedor oficial. Enquanto a entrega real nao estiver concluida, o painel preserva fallback mockado e remove o paciente da fila operacional apos a acao visual.

## Endpoints planejados/futuros

### GET /api/prontuario/:id

Status: planejado/futuro.

Objetivo: buscar prontuario medico consolidado.

Equivalente atual: `GET /api/atendimentos/:id`.

### POST /api/decisao/:id

Status: planejado/futuro.

Objetivo: registrar decisao clinica.

Equivalente atual: `PATCH /api/atendimentos/:id/status`.

### GET /api/receitas/paciente/:id

Status: planejado/futuro.

Objetivo: buscar receita associada ao paciente/atendimento.

Equivalente atual: `GET /api/atendimentos/:id` + `dados_clinicos.memed_receita`.

### POST /api/receita/:id/validar

Status: planejado/futuro.

Objetivo: validar receita antes de marcar como pronta.

Equivalente atual: `POST /api/atendimentos/:id/clinical/validate`.

### POST /api/receita/:id/enviar-whatsapp

Status: planejado/futuro.

Objetivo: enviar receita por WhatsApp.

Equivalente atual: `POST /api/atendimentos/:id/deliver`.

Observacao: envio real deve ocorrer via backend/n8n/WhatsApp API, nunca diretamente pelo frontend.

## Teste local

Backend:

```bash
npm --prefix mdoctor-backend run dev
```

O backend local atual responde na porta `3004`.

Painel:

```bash
npm --prefix mdoctor-panel run dev
```

Variavel local esperada:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3004
```

Validacoes:

```text
http://localhost:3004/health
http://localhost:3004/api/atendimentos
```

O painel deve tentar consumir a API local e manter fallback mockado caso a API esteja offline, retorne erro, esteja sem autenticacao ou responda dados vazios.
