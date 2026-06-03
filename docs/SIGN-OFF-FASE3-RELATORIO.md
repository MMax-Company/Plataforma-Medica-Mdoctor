# Sign-off Fase 3 — Relatório

**Gerado:** 2026-05-29T21:56:43.079Z
**Ambiente:** staging
**Backend:** https://mdoctor-backend-staging-staging.up.railway.app
**Painel:** https://painel-medico-staging-staging.up.railway.app

## Gate

| Gate | Status |
|------|--------|
| API automatizada | APROVADO |
| UI manual (ergonomia) | PENDENTE_OPERADOR |
| Memed produção | BLOQUEADO até sign-off manual |

## IDs de teste

- Primário (approve→deliver): `2a198ff8-382b-45e2-ac94-eb829ba32d25`
- Reject: `9b9812b1-234d-4b16-975d-acf635fed71f`

## Resultados API (automatizado)

### reject_dropdown_api

```json
{
  "ok": true,
  "count": 8
}
```

### fila

```json
{
  "ok": true,
  "status": "waiting",
  "pagamento_confirmado": true,
  "elegivel": true,
  "risco": "BAIXO",
  "receita_anterior": true
}
```

### atendimento

```json
{
  "ok": true,
  "prontuario": {
    "fields": {
      "queixa_principal": true,
      "historico_clinico": true,
      "exame_fisico_telemedicina": true,
      "conduta_sugerida": true,
      "orientacoes_clinicas": true
    },
    "missing": [],
    "medicacao": true,
    "receita": true,
    "complete": true
  },
  "has_historico_endpoint": true
}
```

### fila_lista

```json
{
  "ok": true,
  "total_medical": 40
}
```

### approve

```json
{
  "ok": true,
  "status": "memed_processing",
  "memedSource": "mock"
}
```

### duplicate_approve_block

```json
{
  "ok": true,
  "status": 409,
  "error": "Atendimento já aprovado ou em processamento de receita. Aprovação duplicada não permitida."
}
```

### ready

```json
{
  "ok": true,
  "status": "ready"
}
```

### deliver_mock

```json
{
  "ok": true,
  "status": "delivered",
  "provider": "dry-run"
}
```

### reject

```json
{
  "ok": true,
  "reason_code": "FORA_DO_PROTOCOLO",
  "motivo_rejeicao": {
    "code": "FORA_DO_PROTOCOLO",
    "label": "Fora do protocolo",
    "detail": "Sign-off Fase 3 — reprovação teste",
    "rejected_at": "2026-05-29T21:56:59.083Z",
    "rejected_by": "staging-doctor"
  },
  "audit_code": "FORA_DO_PROTOCOLO"
}
```

### panel

```json
{
  "login_page_ok": true,
  "url": "https://painel-medico-staging-staging.up.railway.app"
}
```

## Checklist manual — UX médica (obrigatório antes Memed produção)

Executar em: https://painel-medico-staging-staging.up.railway.app

| Item | OK | Observação |
|------|-----|------------|
| Fila — carregamento e cards legíveis | [ ] | |
| Fila — elegibilidade/risco visíveis | [ ] | |
| Atendimento — abertura rápida | [ ] | |
| Atendimento — navegação sem erro | [ ] | |
| Prontuário — doença/medicação/posologia | [ ] | |
| Prontuário — conduta/orientações/exame telemedicina | [ ] | |
| Approve — botão, loading, transição memed_processing | [ ] | |
| Reject — dropdown motivos + persistência visual | [ ] | |
| Deliver mock — feedback ao médico | [ ] | |
| Concorrência — 1 médico na fila (procedimento) | [ ] | |

## Assinatura

| Campo | Valor |
|-------|--------|
| Data | |
| Médico supervisor | |
| Resultado manual | [ ] Aprovado [ ] Ressalvas [ ] Bloqueado |

---

**Próximo passo após manual OK:** `docs/MEMED-PRODUCAO-HOMOLOGACAO.md` (Etapa 3).