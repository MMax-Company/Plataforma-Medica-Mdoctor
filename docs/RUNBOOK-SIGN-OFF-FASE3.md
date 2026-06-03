# Runbook — Sign-off Operacional Fase 3

Validação **manual** no painel staging antes do go-live assistido.

**Pré-requisito:** Fase 2 E2E verde (`docs/HOMOLOGACAO-CLINICA-FASE2-RELATORIO.json`).

---

## Sessão de teste (≈ 45–60 min)

### A. Preparação

1. Login: https://painel-medico-staging-staging.up.railway.app/login
2. Criar atendimento de teste:

```bash
cd mdoctor-backend
node scripts/fechar-fase2-staging.js
# Anotar novos atendimento_approve_id e atendimento_reject_id
```

Ou passagem Typebot controlada (`docs/OPERACAO-ASSISTIDA-TYPEBOT-PRODUCAO.md`).

### B. Fila e abertura

| # | Ação | OK | Notas |
|---|------|-----|-------|
| B1 | Fila lista o atendimento de teste | [ ] | |
| B2 | Inelegíveis **não** aparecem | [ ] | |
| B3 | Abrir atendimento — 6 blocos clínicos legíveis | [ ] | |
| B4 | Receita abre (URL assinada ou imagem) | [ ] | |

### C. Approve → deliver

| # | Ação | OK | Status esperado |
|---|------|-----|-----------------|
| C1 | Aprovar (botão verde) | [ ] | `memed_processing` |
| C2 | Abrir prescrição / Memed | [ ] | PDF ou mock |
| C3 | Aceitar receita | [ ] | `ready` |
| C4 | Entregar | [ ] | `delivered` |

### D. Reject

| # | Ação | OK | Status esperado |
|---|------|-----|-----------------|
| D1 | Selecionar motivo `DOCUMENTACAO_INSUFICIENTE` | [ ] | |
| D2 | Reprovar | [ ] | `rejected` |
| D3 | Histórico mostra motivo | [ ] | |

### E. Prontuário

| # | Ação | OK |
|---|------|-----|
| E1 | `/prontuario/{id}` carrega | [ ] |
| E2 | Approve/reject com dropdown motivo | [ ] |

### F. Concorrência (2 browsers)

| # | Ação | Resultado observado | Aceitável? |
|---|------|---------------------|------------|
| F1 | Médico A e B abrem **mesmo** ID | | [ ] Sim [ ] Não |
| F2 | Ambos clicam approve | | Procedimento: evitar |

**Se F2 permitir dupla aprovação:** registrar e manter regra **1 médico/fila**.

### G. Falhas

| # | Simulação | Comportamento | OK |
|---|-----------|---------------|-----|
| G1 | Triagem sem receita | Fora da fila / 422 | [ ] |
| G2 | Triagem sem pagamento | Rejeitado | [ ] |

---

## Assinatura

| Campo | Valor |
|-------|--------|
| Data | |
| Médico supervisor | |
| Operador técnico | |
| Resultado | [ ] Aprovado [ ] Aprovado com ressalvas [ ] Bloqueado |
| Ressalvas | |

Após aprovação, marcar Fase 3 em `docs/GO-LIVE-CHECKLIST.md` e avançar para Fase 4 (Memed sandbox).
