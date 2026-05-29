# Runbook — Homologação clínica Fase 1 (Painel médico)

Ambiente recomendado: **painel staging** + **backend staging** para decisões de teste.  
Para **somente leitura** da fila em produção, use o probe sem credenciais médicas.

---

## Pré-requisitos

| Item | Valor |
|------|--------|
| Backend staging | `https://mdoctor-backend-staging-staging.up.railway.app` |
| Painel staging | `https://painel-medico-staging-staging.up.railway.app` |
| Backend produção (leitura) | `https://web-production-5f178.up.railway.app` |
| Usuário médico teste | `MEDICO_USER` / `MEDICO_PASS` (staging) |

---

## 1. Probe automatizado (API)

```bash
# Produção — fila médica + amostra de prontuários (sem auth)
BACKEND_URL=https://web-production-5f178.up.railway.app \
  node mdoctor-backend/scripts/homologacao-clinica-fase1-probe.js

# Staging
BACKEND_URL=https://mdoctor-backend-staging-staging.up.railway.app \
  node mdoctor-backend/scripts/homologacao-clinica-fase1-probe.js
```

Saída: `docs/HOMOLOGACAO-CLINICA-FASE1-RELATORIO.json`

---

## 2. Login e fila (manual)

1. Acessar painel staging `/login`.
2. Autenticar com médico de teste.
3. Abrir `/fila` ou dashboard com colunas médicas.
4. Confirmar:
   - pacientes com `pagamento_status` confirmado aparecem
   - inelegíveis / sem receita **não** aparecem na fila médica
   - tempo na fila visível (`criado_em`)

---

## 3. Abrir atendimento

1. Clicar em um card da fila → `/atendimento/{id}`.
2. Validar blocos do prontuário:
   - Queixa principal
   - Histórico clínico
   - Exame físico (telemedicina)
   - Conduta sugerida
   - Orientações
3. Validar dados de triagem Typebot (nome, telefone, doença, medicação).
4. Clicar **VISUALIZAR RECEITA** — URL assinada ou imagem carrega.
5. **Não aprovar** em produção neste runbook de Fase 1 se estiver apenas auditando leitura.

---

## 4. Checklist por atendimento

| # | Item | OK | Observação |
|---|------|----|------------|
| 1 | Paciente na fila por critério correto | | |
| 2 | `origem` = `typebot-triagem` | | |
| 3 | `elegibilidade.eligible` = true | | |
| 4 | `pagamento_status` = CONFIRMADO | | |
| 5 | Receita anterior acessível | | |
| 6 | Prontuário automático coerente com triagem | | |
| 7 | Conduta editável antes de decidir | | |
| 8 | Histórico de decisões (`/decisoes`) consistente | | |

---

## 5. Itens conhecidos / limitações

| Limitação | Impacto | Fase futura |
|-----------|---------|-------------|
| Sem lock de atendimento | Dois médicos podem abrir o mesmo caso | Fase 5 |
| Motivo de reprovação texto livre | Menos métricas | Fase 2 |
| Memed mock em staging | Não valida receita real | Fase 3 |
| WhatsApp reprovação | Workflow staging `clinical-rejection-notify` | Fase 4 |

---

## 6. Critério de conclusão Fase 1

- [ ] Probe API sem erros críticos em ≥ 3 atendimentos da fila
- [ ] 2 aberturas manuais no painel com prontuário completo
- [ ] Receita anterior visualizada com sucesso em ≥ 1 caso
- [ ] Relatório JSON arquivado no repositório
- [ ] Pendências registradas em `HOMOLOGACAO-CLINICA-COMPLETA.md` (seção gaps)

Próximo passo: **Fase 2** — `docs/FASE1-APROVAR-REPROVAR-MEMED.md` em ambiente staging.
