# Fase 4 — Memed Sandbox Real

Trocar **mock** por integração **sandbox** controlada (sem Memed produção total).

---

## 1. Estado atual (staging)

| Variável | Valor típico |
|----------|----------------|
| `MEMED_ENABLED` | `false` |
| `MEMED_API_KEY` | ausente |
| `memed.source` em `/readyz` | `mock` |

Comportamento: `mdoctor-backend/src/services/memed.service.js` — se credenciais ausentes → `buildMockPrescription`; em erro HTTP → fallback mock + `memedError`.

---

## 2. Configuração Railway (staging)

Definir no serviço **mdoctor-backend-staging**:

```env
MEMED_ENABLED=true
MEMED_ENV=sandbox
MEMED_ENVIRONMENT=sandbox
MEMED_API_URL=https://integrations.api.memed.com.br/v1
MEMED_API_KEY=<sandbox-key>
MEMED_SECRET_KEY=<sandbox-secret>
MEMED_TIMEOUT_MS=15000
```

Dados do prescritor (conforme contrato Memed):

```env
MEMED_PRESCRITOR_EXTERNAL_ID=
MEMED_PRESCRITOR_NOME=
MEMED_PRESCRITOR_SOBRENOME=
MEMED_PRESCRITOR_CPF=
MEMED_PRESCRITOR_BOARD_NUMBER=
MEMED_PRESCRITOR_BOARD_STATE=
```

**Não** setar `MEMED_ENVIRONMENT=production` nesta fase.

Redeploy backend após alterar envs.

---

## 3. Validação técnica

```bash
# Readiness
curl -s https://mdoctor-backend-staging-staging.up.railway.app/readyz | jq .memed

# E2E clínico (deve mostrar memedSource: memed se sandbox OK)
cd mdoctor-backend
node scripts/fechar-fase2-staging.js
```

| Check | Esperado |
|-------|----------|
| `readyz.memed.configured` | `true` |
| `readyz.memed.source` | `memed` |
| Approve | `memed.source` ≠ só mock |
| PDF/link | URL Memed ou proxy backend acessível |
| Reject posterior | `memed_bloqueado: true` |

---

## 4. Validação clínica (painel)

1. Atendimento elegível com receita.
2. Aprovar → abrir receita sandbox.
3. Conferir medicamento, posologia, paciente, médico.
4. Validar → entregar (mock/dry-run ainda OK).

---

## 5. Rollback Memed

Se sandbox instável:

```powershell
railway variable set MEMED_ENABLED=false -p bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b -e d297af6e-c5e2-406a-9798-69a02f0e7394 -s 53960eb4-a1be-4d7c-b665-462049e52085
```

Redeploy → volta mock (Fase 2 estável).

---

## 6. Critério de conclusão Fase 4

- [ ] Prescrição sandbox gerada em approve
- [ ] Persistência em `prescriptions` + `dados_clinicos.memed_receita`
- [ ] Falha Memed não derruba API (fallback documentado)
- [ ] Supervisor médico validou 1 receita sandbox real (dados fictícios)

Ver também: `docs/MEMED-CONTROLLED-VALIDATION.md`
