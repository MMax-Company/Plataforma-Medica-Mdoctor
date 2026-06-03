# Simulação Elegibilidade — 5 Pacientes Doctor Prescreve

> 2026-05-30T11:56:40.100Z
> Backend: http://localhost:3014

## Conclusão

**Comportamento adequado para piloto fechado:** sim — elegíveis seguem fluxo médico; bloqueios operacionais respeitados.

## Tabela resumo

| # | Cenário | Esperado elegível | Obtido elegível | Status | Fila médica | Fluxo completo | OK |
|---|---------|-------------------|-----------------|--------|-------------|----------------|-----|
| 1 | P1: 1 med, 30d venc, pago | sim | sim | `waiting` | sim | sim | ✅ |
| 2 | P2: 2 med, 45d venc, pago | sim | sim | `waiting` | sim | sim | ✅ |
| 3 | P3: 3 med, 60d venc, pago | sim | sim | `waiting` | sim | sim | ✅ |
| 4 | P4: 1 med, 220d venc, pago | não | não | `rejected` | não | — | ✅ |
| 5 | P5: 1 med, 40d venc, sem pagamento | sim | sim | `waiting` | não | — | ✅ |

## Detalhes por paciente

### Paciente 1 — Hipertensão arterial (HAS)
- ID: `27799187-718a-4e48-a850-c40091076ced`
- Resultado geral: **OK**
- Motivo bloqueio (obtido): nenhum
- Medicamentos carregados: 1 (esperado 1)
- Etapas fluxo elegível:
  - ✅ prontuario_carregado
  - ✅ prontuario_salvo
  - ✅ aprovacao
  - ✅ receita_mock
  - ✅ validacao_receita
  - ✅ whatsapp_simulado
  - ✅ persistencia

### Paciente 2 — Hipertensão arterial (HAS)
- ID: `3259f5f3-cb62-41e1-83ae-e45524b23055`
- Resultado geral: **OK**
- Motivo bloqueio (obtido): nenhum
- Medicamentos carregados: 2 (esperado 2)
- Etapas fluxo elegível:
  - ✅ prontuario_carregado
  - ✅ prontuario_salvo
  - ✅ aprovacao
  - ✅ receita_mock
  - ✅ validacao_receita
  - ✅ whatsapp_simulado
  - ✅ persistencia

### Paciente 3 — Hipertensão arterial + Diabetes mellitus tipo 2
- ID: `4370082c-6b75-4362-92ad-d2f0a3caa3a1`
- Resultado geral: **OK**
- Motivo bloqueio (obtido): nenhum
- Medicamentos carregados: 3 (esperado 3)
- Etapas fluxo elegível:
  - ✅ prontuario_carregado
  - ✅ prontuario_salvo
  - ✅ aprovacao
  - ✅ receita_mock
  - ✅ validacao_receita
  - ✅ whatsapp_simulado
  - ✅ persistencia

### Paciente 4 — Hipertensão arterial (HAS)
- ID: `6d7aa4f7-a150-407f-8162-68e90fc1f8e8`
- Resultado geral: **OK**
- Motivo bloqueio (obtido): receita_vencida_acima_180
- Medicamentos carregados: 1 (esperado 1)

### Paciente 5 — Hipertensão arterial (HAS)
- ID: `701d8cc9-86cc-4712-899b-891d66c31e60`
- Resultado geral: **OK**
- Motivo bloqueio (obtido): pagamento_pendente
- Medicamentos carregados: 1 (esperado 1)

## O que funcionou

- Login médico
- P1: criado (27799187-718a-4e48-a850-c40091076ced)
- P1: fluxo médico completo (approve + receita mock + dry-run)
- P1: elegibilidade conforme esperado
- P1: presença/ausência na fila médica OK
- P2: criado (3259f5f3-cb62-41e1-83ae-e45524b23055)
- P2: fluxo médico completo (approve + receita mock + dry-run)
- P2: elegibilidade conforme esperado
- P2: presença/ausência na fila médica OK
- P3: criado (4370082c-6b75-4362-92ad-d2f0a3caa3a1)
- P3: fluxo médico completo (approve + receita mock + dry-run)
- P3: elegibilidade conforme esperado
- P3: presença/ausência na fila médica OK
- P4: criado (6d7aa4f7-a150-407f-8162-68e90fc1f8e8)
- P4: approve bloqueado corretamente (409)
- P4: elegibilidade conforme esperado
- P4: presença/ausência na fila médica OK
- P5: criado (701d8cc9-86cc-4712-899b-891d66c31e60)
- P5: approve bloqueado corretamente (422)
- P5: elegibilidade conforme esperado
- P5: presença/ausência na fila médica OK

## O que falhou

- Nenhuma falha crítica.

## Observações

- Simulação **sem flag** `receita_muito_antiga` — P4 (220d) bloqueado pelo backend via `receita_vencida_dias` (`renovacao_insegura`).
- Teste executado contra backend **local** (código novo); staging Railway ainda sem esta alteração (sem deploy).
- WhatsApp: apenas dry-run/mock; Memed: receita mock via API.