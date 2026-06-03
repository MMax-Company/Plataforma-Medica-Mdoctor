# Simulação Clínica — Painel Médico

> 2026-05-30T11:29:27.607Z
> Backend: https://mdoctor-backend-staging-staging.up.railway.app
> Painel: http://localhost:3001

## Conclusão

**Painel utilizável para piloto fechado médico:** sim, com ressalvas abaixo.

## O que funcionou

- Login médico (drmax.matos)
- /api/auth/me
- Fluxo completo API: has
- Fluxo completo API: diabetes
- Fluxo completo API: hipotireoidismo
- UI: tela_login_abre
- UI: fila_1366_sem_overflow
- UI: fila_3_colunas
- UI: atendimento_nome_visivel
- UI: botao_reprovar_visivel
- UI: botao_aprovar_visivel
- UI: dados_clinicos_ui
- UI: sem_erro_critico_frontend

## O que falhou

- Nenhuma falha crítica na simulação API + UI (código local em `localhost:3001`).
- **Staging público** (`painel-medico-staging-staging.up.railway.app`): tela de atendimento ainda sem deploy recente — nome do paciente e botões Aprovar/Reprovar não apareceram na checagem anterior (fetch sem token / layout antigo). Requer redeploy do painel para alinhar com o código validado localmente.

## Ressalvas

| Item | Situação |
|------|----------|
| Memed | Mock controlado via API (`receita_mock_persistida`); iframe Memed real não exercido |
| WhatsApp | `provider: dry-run` — interrompido antes de envio real |
| Reject | Botão **Reprovar** visível na UI; fluxo completo de rejeição não foi executado (apenas approve nos 3 pacientes) |
| UI 1366×768 | Validada no 1º paciente (HAS), antes do approve, com código local |
| Prontuário / receita | Telas navegadas via API; clique manual em “Salvar prontuário” e “Emitir receita” não automatizado no browser |

## Pacientes simulados

### Hipertensão arterial (HAS) (`82d31e92-13e8-4d23-8c4a-1981f5cb6b9e`)
- Resultado: OK
  - ✅ fila_lista_paciente
  - ✅ prontuario_dados_carregados
  - ✅ prontuario_salvo
  - ✅ aprovar_atendimento → approved
  - ✅ receita_mock_persistida
  - ✅ validar_receita_ready → ready
  - ✅ whatsapp_simulado_sem_envio_real
  - ✅ persistencia_final

### Diabetes mellitus tipo 2 (`ad30e6fd-2139-4d96-8757-3c078e5e5bf1`)
- Resultado: OK
  - ✅ fila_lista_paciente
  - ✅ prontuario_dados_carregados
  - ✅ prontuario_salvo
  - ✅ aprovar_atendimento → approved
  - ✅ receita_mock_persistida
  - ✅ validar_receita_ready → ready
  - ✅ whatsapp_simulado_sem_envio_real
  - ✅ persistencia_final

### Hipotireoidismo (`32109048-780b-422a-969a-c75d4a4b3a69`)
- Resultado: OK
  - ✅ fila_lista_paciente
  - ✅ prontuario_dados_carregados
  - ✅ prontuario_salvo
  - ✅ aprovar_atendimento → approved
  - ✅ receita_mock_persistida
  - ✅ validar_receita_ready → ready
  - ✅ whatsapp_simulado_sem_envio_real
  - ✅ persistencia_final

## UI 1366×768 (amostra — último paciente)

- ✅ tela_login_abre
- ✅ fila_1366_sem_overflow
- ✅ fila_3_colunas
- ✅ atendimento_nome_visivel
- ✅ botao_reprovar_visivel
- ✅ botao_aprovar_visivel
- ✅ dados_clinicos_ui
- ✅ sem_erro_critico_frontend