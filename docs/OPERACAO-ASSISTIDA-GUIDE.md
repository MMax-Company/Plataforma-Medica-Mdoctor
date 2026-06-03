# Guia — Operação Médica Assistida Controlada

Como operar o Doctor Prescreve na fase de **go-live assistido**: poucos atendimentos reais, supervisão técnica e médica, baixo risco.

---

## 1. Papéis

| Papel | Responsabilidade |
|-------|------------------|
| Médico operador | Decisão clínica (approve/reject), validação Memed, entrega |
| Supervisor médico | Revisar primeiros casos, critérios de reprovação |
| Operador técnico | Typebot, fila, logs, rollback se necessário |
| Paciente (teste/real) | Fluxo Typebot → triagem → pagamento → receita |

**Regra de ouro no go-live inicial:** **um médico por vez na fila** até existir lock de atendimento no sistema.

---

## 2. URLs e acesso

| Sistema | URL |
|---------|-----|
| Painel médico (staging) | https://painel-medico-staging-staging.up.railway.app |
| Backend API (staging) | https://mdoctor-backend-staging-staging.up.railway.app |
| Typebot paciente (op. assistida) | https://typebot.co/doctor-prescreve-8rmljgu |
| Login painel | `/login` — credenciais `MEDICO_USER` / `MEDICO_PASS` (Railway staging) |

Para **primeiros reais supervisionados**, alinhar se o paciente usa Typebot produção acima ou bot staging — documentar na planilha do dia.

---

## 3. Fluxo do paciente (entrada)

```text
Typebot
  → n8n (typebot-webhook)  [preferencial]
  → OU POST /api/webhook/triagem  [fallback técnico / E2E]
  → backend cria atendimento + prontuário
  → fila médica (se elegível + pago + receita)
```

**Conferir após cada entrada:**

1. Atendimento aparece na **fila** do painel.
2. `pagamento_status` = CONFIRMADO.
3. Receita anterior visível (URL ou upload externo).
4. Elegibilidade coerente (sem red flags).

Scripts de verificação:

```bash
ATENDIMENTO_ID=<uuid> node mdoctor-backend/scripts/verificar-operacao-assistida-typebot.js
node mdoctor-backend/scripts/homologacao-clinica-fase1-probe.js
```

---

## 4. Fluxo do médico (painel)

### 4.1 Fila → atendimento

1. Login → **Fila** ou dashboard.
2. Escolher card (tempo na fila, nome, condição).
3. Abrir **Atendimento** (`/atendimento/{id}`).

**Checklist clínico na tela:**

- Doença / condição crônica
- Medicação e posologia
- Conduta e orientações
- Exame telemedicina
- Receita anterior (botão visualizar)
- Pagamento confirmado
- Elegibilidade e risco

### 4.2 Decisão — reprovar

1. Selecionar **motivo estruturado** (dropdown).
2. Se `OUTROS`, preencher observação (mín. 5 caracteres).
3. Clicar **Reprovar**.

**API:** `POST /api/atendimentos/:id/clinical/reject` com `reason_code`.

**Efeitos:** status `rejected`, `memed_bloqueado`, `motivo_rejeicao` persistido, notificação n8n (se configurada), audit `clinical_rejected`.

### 4.3 Decisão — aprovar

1. Confirmar receita e elegibilidade.
2. **Aprovar** → status `memed_processing`, Memed mock ou sandbox.
3. Abrir prescrição Memed / receita gerada.
4. **Aceitar/validar** → `ready`.
5. **Entregar** (mock ou dry-run) → `delivered`.

**API (ordem):**

```text
POST .../clinical/approve
POST .../clinical/validate
POST .../deliver
```

**Não usar** `PATCH /api/atendimentos/:id/status` para approve/reject — legado.

### 4.4 Prontuário alternativo

Rota `/prontuario/{id}` — mesmo par approve/reject via API clínica; útil para revisão narrativa longa.

---

## 5. Motivos de reprovação (referência)

| Código | Quando usar |
|--------|-------------|
| `RED_FLAG` | Sinais de alerta |
| `DOCUMENTACAO_INSUFICIENTE` | Anexos/prontuário insuficientes |
| `RECEITA_AUSENTE` | Sem receita anterior válida |
| `FORA_DO_PROTOCOLO` | Fora do protocolo de renovação |
| `MEDICACAO_INCOMPATIVEL` | Medicação incompatível |
| `RISCO_CLINICO` | Risco alto para telemedicina assíncrona |
| `DADOS_INCONSISTENTES` | Dados conflitantes |
| `OUTROS` | Com texto obrigatório |

`GET /api/atendimentos/clinical/reject-reasons` (autenticado).

---

## 6. Cenários de falha — o que fazer

| Situação | Ação do médico | Ação técnica |
|----------|----------------|--------------|
| Approve retorna 422 | Não forçar; reprovar ou pedir documentação | Verificar receita URL, pagamento, elegibilidade |
| Memed warning / mock | Validar se sandbox não configurado | Fase 4: configurar credenciais sandbox |
| Entrega falha | Não reenviar em loop | Ver `delivery` logs; conferir `DELIVERY_MOCK_ENABLED` |
| Paciente não na fila | Não criar manualmente sem triagem | Rastrear Typebot → n8n → backend |
| Duplo clique approve | Segundo request pode 409 | Um médico por atendimento; refresh e conferir status |

---

## 7. Concorrência (procedimento temporário)

Até implementar lock:

1. Coordenar no WhatsApp interno qual médico “pega” a fila.
2. Não abrir o mesmo `atendimentoId` em duas abas.
3. Após approve, o segundo médico deve ver status já alterado.

**Teste de sign-off:** duas sessões staging — documentar comportamento em `docs/GO-LIVE-CHECKLIST.md` Fase 3.3.

---

## 8. Escalonamento

| Severidade | Exemplo | Ação |
|------------|---------|------|
| P3 | UX confusa, typo | Registrar issue, operar com cuidado |
| P2 | Webhook lento, fila atrasada | Operador técnico reinicia workflow / usa triagem direta |
| P1 | Backend down, dados errados | Rollback (`docs/ROLLBACK-PLAN.md`), pausar Typebot |
| P0 | Risco paciente, prescrição indevida | Parar operação, supervisor médico, auditoria manual |

---

## 9. Fim do dia (rotina)

- [ ] Zerar fila ou justificar pendentes
- [ ] Exportar IDs atendidos (planilha)
- [ ] Rodar `node scripts/go-live-health-probe.js`
- [ ] Revisar audit logs Supabase (ações `clinical_*`, `delivery_*`)
- [ ] Anotar incidentes para retrospectiva

---

## 10. Documentos relacionados

- `docs/GO-LIVE-CHECKLIST.md` — gates
- `docs/RUNBOOK-HOMOLOGACAO-CLINICA-FASE2.md` — E2E técnico
- `docs/OPERACAO-ASSISTIDA-TYPEBOT-PRODUCAO.md` — entrada Typebot produção
- `docs/OBSERVABILIDADE-MINIMA.md` — logs e alertas
- `docs/ROLLBACK-PLAN.md` — reversão
