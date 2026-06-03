# Relatório final — deploy operacional staging Doctor Prescreve

**Data:** 2026-05-29  
**Commit de referência:** `6751d4a` (`codex/legacy-compat-infra`)  
**Escopo:** publicação Typebot, n8n, Railway, smoke/E2E — **sem produção**

---

## Resumo executivo

| Item | Status | Detalhe |
|------|--------|---------|
| **Backend staging** | ✅ Implantado | `railway up` com código local — probe `terms_acceptance` **OK** |
| **Painel staging** | ✅ Deploy disparado | `railway up` a partir de `mdoctor-panel/` |
| **Typebot cloud** | ❌ Bloqueado | `TYPEBOT_API_TOKEN` **ausente** (local + Railway) |
| **n8n workflows (API)** | ❌ Bloqueado | `N8N_API_KEY` **ausente** no Railway n8n |
| **n8n runtime** | ⚠️ Parcial | Webhook responde **200**, corpo vazio — não retorna `atendimento` |
| **E2E backend direto** | ✅ | Fila, bloqueios, termos, suporte, login com `railway run` |
| **E2E WhatsApp real** | ⏳ Manual | Evolution + Typebot publicado — depende de token + teste humano |

---

## 1. Typebot (`doctor-prescreve-8rmljgu`)

### Export no repositório (pronto)

- `docs/typebot/typebot-doctor-prescreve-staging-safe.json`
- Validado: fluxo reorganizado, documentos com links amigáveis, webhook **somente staging**

### Publicação na nuvem

**Não executada** — variável `TYPEBOT_API_TOKEN` não está definida neste ambiente nem no serviço Railway `mdoctor-backend-staging`.

### Ação objetiva (você ou CI com secret)

1. Em [Typebot](https://app.typebot.io) → **Settings → API tokens** → criar token com permissão de edição/publicação.
2. No terminal (não commitar o token):

```powershell
cd "C:\Users\drmax\OneDrive\Área de Trabalho\Mdoctor-Survive"
$env:TYPEBOT_API_TOKEN = "SEU_TOKEN_AQUI"
$env:TYPEBOT_ID = "higij2z0xihxxkr378rmljgu"
node mdoctor-backend/scripts/patch-typebot-reorganize.js
node mdoctor-backend/scripts/validate-typebot-staging-safe.js
node mdoctor-backend/scripts/publish-typebot-staging.js
```

3. Validar em: https://typebot.co/doctor-prescreve-8rmljgu

**Opcional Railway:** adicionar `TYPEBOT_API_TOKEN` nas variáveis do serviço backend staging (somente se for usar publish via CI).

---

## 2. n8n (workflows staging)

### Workflows alvo

| Nome | Arquivo |
|------|---------|
| `typebot-webhook-staging` | `docs/n8n-workflows/typebot-webhook-staging.json` |
| `clinical-rejection-notify-staging` | `docs/n8n-workflows/clinical-rejection-notify-staging.json` |
| `Evolution Webhook - Staging` | `docs/n8n-workflows/evolution-webhook-staging.json` |

### Estado atual

- Serviço **online:** https://n8n-staging-staging-2dfe.up.railway.app
- `POST /webhook/typebot-webhook` → **200** (sem body JSON com `atendimento`)
- Normalizador **embutido no JSON** do repo (`embed-n8n-typebot-payload.js`, `embed-n8n-whatsapp-menu.js`)
- **Republicação via API não feita** — não existe `N8N_API_KEY` nas variáveis do serviço n8n staging

### Ação objetiva

1. n8n staging → **Settings → API** → criar API key.
2.:

```powershell
$env:N8N_API_KEY = "SUA_CHAVE_N8N"
$env:N8N_BASE_URL = "https://n8n-staging-staging-2dfe.up.railway.app"
node mdoctor-backend/scripts/staging-deploy-2-2.js
```

(O script publica Typebot + 3 workflows; se só quiser n8n, use `deploy-n8n-workflow.js` por arquivo.)

3. Após republicar, repetir:

```powershell
$env:N8N_WEBHOOK_SECRET = "..."   # já configurado no ambiente local
node mdoctor-backend/scripts/e2e-typebot-n8n-evolution-staging.js
```

Esperado: `n8n` retorna JSON com `atendimento.id` ou lista resolve o atendimento.

---

## 3. Railway (backend + painel)

### O que foi feito

| Serviço | Projeto | Service | Ação |
|---------|---------|---------|------|
| Backend | `Backend-Mdoctor` / staging | `mdoctor-backend-staging` | `railway up --detach` (upload código local `6751d4a`) |
| Painel | `Painel-MDoctor` / staging | `painel-medico-staging` | `railway up --detach` |

`railway redeploy --from-source` anterior **não** tinha implantado `6751d4a` (probe `terms_acceptance` falhou). Após `railway up`, probe:

```json
{
  "hasTermsAcceptance": true,
  "deploy6751Likely": true,
  "health": 200
}
```

### Health / readyz

- `GET /health` → **200** OK  
- `GET /readyz` → **warning** (esperado em staging: Memed mock, CORS, delivery mock)  
- Supabase: **conectado**  
- Memed: **mock**

### Variáveis staging (backend) — presentes

`MEDICO_USER`, `MEDICO_PASS`, `JWT_SECRET`, `N8N_WEBHOOK_SECRET`, `SUPABASE_*`, `LEGACY_COMPAT_TYPEBOT`, etc.

### Variáveis faltantes para fechamento Typebot/n8n API

| Variável | Onde configurar |
|----------|-----------------|
| `TYPEBOT_API_TOKEN` | Local/CI ou Railway backend (opcional) |
| `N8N_API_KEY` | Railway n8n staging ou local para `deploy-n8n-workflow.js` |

### Painel

- URL: https://painel-medico-staging-staging.up.railway.app  
- `/login`, `/dashboard` → **200** após deploy  
- Confirmar `NEXT_PUBLIC_API_URL` = backend staging no Railway do painel

---

## 4. Smoke / E2E executados

### Automático (sucesso)

| Teste | Resultado |
|-------|-----------|
| `validate-typebot-staging-safe.js` | ✅ |
| `test-typebot-eligibility.js` | ✅ |
| `test-fase1-payload-normalizer.js` | ✅ |
| `smoke-fase1-staging.js` | ✅ (health, fila, bloqueios, n8n 200) |
| `probe-staging-deploy.js` | ✅ `terms_acceptance` após `railway up` |
| `staging-e2e-operacional.js` com `railway run` | ✅ exceto idempotency flag |

### E2E com `railway run` (credenciais staging reais)

- Login médico: ✅  
- `GET /api/atendimentos/support-queue`: ✅  
- Webhook → fila `waiting`: ✅  
- `terms_acceptance` persistido: ✅  
- Bloqueio não pago: ✅  
- Suporte WhatsApp (`POST /api/whatsapp/support`): ✅  
- **Idempotency:** segundo POST retornou 200 sem `duplicate: true` (verificar store/instância — não bloqueante para go-live staging)

### n8n → backend (cadeia incompleta)

- Webhook n8n: **200**, sem `atendimento` no body → workflow em runtime **desatualizado** vs JSON do repo até republicar com `N8N_API_KEY`.

### Fluxo painel completo (aprovar → Memed → entregar)

Não automatizado nesta sessão porque depende de n8n criar atendimento visível na lista ou de script com `atendimentoId` fixo. Após republicar n8n, rodar:

```powershell
cd mdoctor-backend
railway run node scripts/e2e-typebot-n8n-evolution-staging.js
```

---

## 5. Bloqueios validados (API)

| Cenário | Resultado |
|---------|-----------|
| Não pago | `rejected` ✅ |
| Sem foto da receita | `rejected` ✅ |
| Elegível + pago + foto | `waiting` ✅ |
| Suporte WhatsApp | Rota dedicada ✅ (não mistura fila médica) |
| LGPD / alerta / &lt;30d / sem receita (Typebot) | No export JSON ✅ (testes locais) |

---

## 6. Teste manual WhatsApp (5/5 — humano)

Checklist após **Typebot publicado** + **n8n republicado**:

1. Mensagem ao número Evolution staging → menu.  
2. Opção renovação → Typebot `doctor-prescreve-8rmljgu`.  
3. LGPD + links amigáveis → Autorizo.  
4. Telemedicina + não urgência → continuar.  
5. Triagem → termos → pagamento (Stripe staging).  
6. Medicamentos + upload foto.  
7. Painel: paciente na **fila médica**.  
8. Prontuário → aprovar → Memed → receitas prontas → envio → `delivered`.  
9. Repetir: recusar LGPD / alerta / sem receita (não deve pagar nem entrar na fila).

---

## 7. Scripts úteis

```bash
# Validação + relatório JSON
node mdoctor-backend/scripts/staging-fechamento-geral.js

# Probe deploy 6751d4a
node mdoctor-backend/scripts/probe-staging-deploy.js

# E2E com env do Railway
cd mdoctor-backend && railway run node scripts/staging-e2e-operacional.js

# Deploy Typebot + n8n (requer tokens)
node mdoctor-backend/scripts/staging-deploy-2-2.js

# Railway upload direto (feito nesta sessão)
cd mdoctor-backend && railway up --detach
cd mdoctor-panel && railway up --detach
```

---

## 8. Próximos passos reais (ordem)

1. **Inserir `TYPEBOT_API_TOKEN`** e rodar `publish-typebot-staging.js`.  
2. **Inserir `N8N_API_KEY`** e rodar `staging-deploy-2-2.js` (ou deploy dos 3 JSONs).  
3. **Teste manual WhatsApp** (checklist §6).  
4. Confirmar painel build no Railway (logs do deploy `painel-medico-staging`).  
5. (Opcional) Configurar deploy Git automático do branch `codex/legacy-compat-infra` para não depender de `railway up` manual.

---

## 9. Conclusão

O **staging backend está alinhado ao commit `6751d4a`** (comprovado por `terms_acceptance` e rotas de suporte). O **painel** teve deploy disparado. O gargalo restante é **operacional/credencial**: publicar Typebot e republicar n8n com API keys que não estavam disponíveis neste ambiente. Assim que os dois tokens forem aplicados e o checklist WhatsApp for executado, o ciclo staging fica **100% fechado**.
