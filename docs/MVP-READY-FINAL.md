# MVP Ready — Doctor Prescreve (Operação Assistida)

Estado consolidado do MVP para **operação médica assistida controlada**.

---

## Sequência obrigatória

```text
Fase 3 sign-off manual (staging)
  → ajustes críticos (se houver)
  → Memed produção controlada
  → operação assistida real (1º caso supervisionado)
```

**Não pular etapas.**

---

## Status por etapa

| Etapa | Descrição | Status | Evidência |
|-------|-----------|--------|-----------|
| 0 | Fase 2 clínica E2E staging | Concluída | `HOMOLOGACAO-CLINICA-FASE2-RELATORIO.json` |
| 1 | Sign-off Fase 3 API | Automatizado | `SIGN-OFF-FASE3-RELATORIO.md` |
| 1b | Sign-off Fase 3 UX manual | **Pendente operador** | Assinatura no relatório |
| 2 | Ajustes críticos | Sob demanda | Issues / commits |
| 3 | Memed produção homologada (credenciais + JWT) | **Concluída (isolada)** | `MEMED-PRODUCAO-CONTROLADA-RELATORIO.json` |
| 3b | Fluxo Sinapse no approve (sem REST auto) | **Implementado + staging validado** | `FLUXO-RECEITA-OFICIAL.md` |
| 4 | 1º atendimento real ponta a ponta (widget) | **Gate manual aberto** | `PRIMEIRA-RECEITA-REAL-RELATORIO.md` |

---

## Critérios finais do MVP

O MVP é **operacional REAL** quando todos marcados:

- [ ] Sign-off manual Fase 3 aprovado
- [ ] Emissão **real** via widget Sinapse + `/api/memed/receita` (approve não emite)
- [ ] PDF Memed válido conferido pelo médico
- [ ] Entrega controlada documentada (`delivered`)
- [ ] Fluxo médico completo repetível
- [ ] Estabilidade mínima (health probe + rollback testado)
- [ ] 1 caso real supervisionado encerrado com sucesso

**Parcial (2026-05-29):** approve → Sinapse → persist → validate → deliver validados tecnicamente; emissão Memed **real** pendente operador.

---

## Componentes validados (técnico)

| Componente | Staging | Produção assistida |
|------------|---------|-------------------|
| Typebot → n8n → backend | Homologado | `OPERACAO-ASSISTIDA-TYPEBOT-PRODUCAO.md` |
| Fila médica | OK | |
| Approve/reject clínico | OK (approve → `approved`, sem Memed auto) | |
| Motivos estruturados | 8 códigos | |
| Fluxo receita Sinapse | OK até gate manual | `FLUXO-RECEITA-OFICIAL.md` |
| Memed JWT produção | OK | `MEMED-PRODUCAO-CONTROLADA-RELATORIO.json` |
| Persistência status Supabase | OK (mapeamento legado) | |
| Validate → ready | OK | |
| Deliver dry-run → delivered | OK | |
| Audit mínimo | Supabase | |

---

## Comandos de verificação

```bash
# Health
node mdoctor-backend/scripts/go-live-health-probe.js

# Primeira receita supervisionada (staging)
cd mdoctor-backend && LOAD_RAILWAY_VARS=1 node scripts/primeira-receita-real-supervisionada.js

# Sign-off Fase 3 (API)
node mdoctor-backend/scripts/sign-off-fase3-staging.js
```

---

## Fora do MVP operacional

- Escala comercial / marketing pesado
- Múltiplos médicos sem lock de atendimento
- WhatsApp produção em massa
- Billing Stripe avançado
- Automações agressivas

---

## Documentação operacional

| Documento | Uso |
|-----------|-----|
| `GO-LIVE-CHECKLIST.md` | Gates master |
| `OPERACAO-ASSISTIDA-GUIDE.md` | Dia a dia staging |
| `OPERACAO-REAL-GUIDE.md` | 1º caso real |
| `PRIMEIRA-RECEITA-REAL-RELATORIO.md` | Relatório execução |
| `ROLLBACK-PLAN.md` | Reversão |
| `OBSERVABILIDADE-MINIMA.md` | Logs e alertas |

---

## Registro do 1º caso real

| Campo | Valor |
|-------|--------|
| Data | 2026-05-29 (automático até gate widget) |
| atendimento_id (aberto) | `525b5d0e-646d-462e-b256-265c87d05d8e` |
| paciente (iniciais) | Paciente Fase2 (triagem script) |
| médico | staging-doctor / dr_max_vinicius_001 |
| supervisor | pendente |
| memed_id | **pendente emissão Sinapse** |
| entrega (canal) | dry-run WhatsApp (staging) |
| status final | `receita_em_edicao` (aguardando widget) |
| incidentes | Token `/api/memed/token` corrigido; status Supabase mapeado |
