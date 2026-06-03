# Guia — Primeira Operação Real Supervisionada

Executar o **primeiro atendimento real** ponta a ponta após:

1. Sign-off Fase 3 manual **Aprovado**
2. Memed produção homologada (`MEMED-PRODUCAO-HOMOLOGACAO.md`)

---

## 1. Pré-voo (30 min antes)

| # | Ação | OK |
|---|------|-----|
| 1 | `node scripts/go-live-health-probe.js` → success | [ ] |
| 2 | `GET /readyz` → Memed `configured: true`, `MEMED_ALLOW_MOCK_FALLBACK=false` | [ ] |
| 3 | Médico + supervisor com login painel | [ ] |
| 4 | Typebot link correto (produção assistida) | [ ] |
| 5 | Plano de rollback lido (`ROLLBACK-PLAN.md`) | [ ] |
| 6 | **Apenas 1 médico** na fila | [ ] |

---

## 2. Fluxo do paciente (real)

```text
Typebot (paciente real consentido)
  → n8n / triagem
  → fila médica
```

**Checklist entrada:**

- [ ] Pagamento confirmado no fluxo
- [ ] Receita anterior enviada (foto válida)
- [ ] Dados coerentes (nome, telefone, medicação)

Anotar: `atendimento_id` quando disponível.

```bash
ATENDIMENTO_ID=<uuid> node mdoctor-backend/scripts/verificar-operacao-assistida-typebot.js
```

**Alternativa staging (triagem script):**

```bash
cd mdoctor-backend
LOAD_RAILWAY_VARS=1 node scripts/primeira-receita-real-supervisionada.js
# Para o gate manual com atendimento_id no JSON de saída
```

---

## 3. Fluxo do médico (supervisionado)

### 3.1 Revisão clínica

1. Abrir fila → selecionar atendimento.
2. Supervisor confere prontuário **antes** de aprovar:
   - doença, medicação, posologia
   - elegibilidade e risco
   - receita anterior legível

### 3.2 Aprovar (sem emissão automática)

1. Médico clica **Aprovar**.
2. Confirmar:
   - [ ] Status **`approved`** (não `memed_processing` com receita pronta)
   - [ ] **Nenhuma** receita em `dados_clinicos.memed_receita` ainda
   - [ ] Resposta indica `manual_sinapse_required`

**Não** esperar PDF no approve. **Não** chamar `POST /prescriptions` Memed.

### 3.3 Emitir receita REAL (Sinapse)

1. Abrir **`/receita?atendimentoId=<uuid>`** (ou botão no atendimento/prontuário).
2. Widget Sinapse carrega com token Memed produção.
3. Revisar prescritor, paciente, medicação, posologia.
4. **Emitir e imprimir** no widget (ação explícita do médico).
5. Anotar `receitaId` Memed e URL do PDF.

### 3.4 Persistência automática

O painel chama `POST /api/memed/receita` após impressão. Confirmar status **`receita_emitida`** e campos:

- `memed_id` / `receitaId`
- `pdf_url`
- `issued_at`

### 3.5 Validar e entregar (controlada)

1. **Aceitar receita** → `ready`.
2. **Entregar** por canal acordado (WhatsApp em **dry-run** no staging; sem massa).
3. Confirmar status **`delivered`**.

**Conclusão via script (após widget):**

```powershell
$env:LOAD_RAILWAY_VARS="1"
$env:ATENDIMENTO_ID="<uuid>"
$env:SKIP_CREATE="1"
$env:MEMED_RECEITA_ID="<id-memed>"
$env:MEMED_PDF_URL="<url-pdf>"
node mdoctor-backend/scripts/primeira-receita-real-supervisionada.js
```

---

## 4. Encerramento do caso

| Verificação | OK |
|-------------|-----|
| Status final `delivered` | [ ] |
| `dados_clinicos.memed_receita` persistido (real, não mock) | [ ] |
| PDF aberto e conferido pelo médico | [ ] |
| Audit: approve, emissão, validate, deliver | [ ] |
| Registro em `MVP-READY-FINAL.md` | [ ] |
| `docs/PRIMEIRA-RECEITA-REAL-RELATORIO.md` atualizado | [ ] |

---

## 5. Se algo der errado

| Situação | Ação imediata |
|----------|----------------|
| Approve duplicado acidental | Verificar status; não clicar de novo (409 esperado) |
| Token Memed 502 | Verificar vars prescritor; redeploy backend |
| Widget não carrega | `GET /api/memed/token` com médico logado |
| Memed falhou | Pausar fila; rollback env Memed se necessário |
| Deliver sem status `delivered` | Confirmar status Supabase `DELIVERED` (não `FINISHED`) |

---

## 6. Pós-caso (mesmo dia)

- Retrospectiva 15 min (médico + técnico)
- Atualizar `SIGN-OFF-FASE3-RELATORIO.md` se achados UX
- Marcar MVP operacional em `MVP-READY-FINAL.md`

---

## URLs staging

| Sistema | URL |
|---------|-----|
| Painel | https://painel-medico-staging-staging.up.railway.app |
| Backend | https://mdoctor-backend-staging-staging.up.railway.app |
| Receita (exemplo) | `/receita?atendimentoId=525b5d0e-646d-462e-b256-265c87d05d8e` |

---

## Atendimento staging aberto (2026-05-29)

Use **`525b5d0e-646d-462e-b256-265c87d05d8e`** — já aprovado, aguardando emissão Sinapse. Ver `PRIMEIRA-RECEITA-REAL-RELATORIO.md`.
