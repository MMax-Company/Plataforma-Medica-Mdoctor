# Plano de Rollback — Go Live Assistido

Procedimentos para **reverter rapidamente** mudanças em backend, painel e n8n sem expor pacientes a risco prolongado.

**Princípio:** rollback = voltar ao último deployment **SUCCESS** conhecido + workflows/documentação versionados no Git.

---

## 1. Quando acionar rollback

| Gatilho | Exemplo |
|---------|---------|
| P1 técnico | Backend 5xx sustentado, login médico impossível |
| Regressão clínica | Approve quebra fila; reject não persiste motivo |
| Integração | n8n parou de criar atendimentos |
| Segurança | Credencial vazada, CORS aberto indevidamente |

**Não acionar** por um único 422 clínico esperado (receita ausente) — é regra de negócio.

**Ação imediata paralela:** pausar link Typebot público (comunicar equipe) enquanto reverte serviços.

---

## 2. IDs Railway (referência)

| Projeto | Environment ID | Service | Service ID |
|---------|----------------|---------|------------|
| Backend-Mdoctor | `d297af6e-c5e2-406a-9798-69a02f0e7394` (staging) | mdoctor-backend-staging | `53960eb4-a1be-4d7c-b665-462049e52085` |
| Painel-MDoctor | `faae345a-79ee-46e9-abf6-d2dedd08a538` (staging) | painel-medico-staging | `626fc9d2-3f6a-417c-b3a7-e3e21846edb8` |

Produção backend legado (`web`) — **não usar para rollback deste MVP** sem alinhamento explícito.

Deployments Fase 2 (baseline estável conhecido):

- Backend: `e3aa7a15-abd4-402c-9ebf-13e990b42389`
- Painel: `084e0b9a-fea7-434c-a974-a8d737d300e1`

---

## 3. Rollback backend (Railway)

### 3.1 Via dashboard (recomendado)

1. Projeto **Backend-Mdoctor** → ambiente **staging** → serviço **mdoctor-backend-staging**.
2. Aba **Deployments** → deployment anterior com status **SUCCESS**.
3. **Redeploy** / **Rollback** (conforme UI Railway).
4. Aguardar health: `GET https://mdoctor-backend-staging-staging.up.railway.app/health` → 200.
5. `GET /readyz` — conferir Supabase e Memed.

### 3.2 Via CLI

```powershell
cd mdoctor-backend
$env:RAILWAY_PROJECT_ID="bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b"
$env:RAILWAY_ENVIRONMENT="staging"
$env:RAILWAY_SERVICE="mdoctor-backend-staging"

# Listar deployments
railway deployment list --json

# Redeploy de um commit/tag conhecido (substituir pelo ID estável)
railway redeploy --deployment <DEPLOYMENT_ID>
```

### 3.3 Rollback de variáveis

Se o incidente foi **só env** (ex.: Memed sandbox errado):

```powershell
railway variable list -p bed0e3b3-fa4b-4bc2-a7fb-dcabca09cd9b -e d297af6e-c5e2-406a-9798-69a02f0e7394 -s 53960eb4-a1be-4d7c-b665-462049e52085 --json
# Restaurar valores anotados na planilha de change
railway variable set MEMED_ENABLED=false --skip-deploys
# Depois redeploy ou trigger deploy
```

**Baseline Memed seguro (staging):** `MEMED_ENABLED=false`, mock ativo — ver `docs/MEMED-CONTROLLED-VALIDATION.md`.

---

## 4. Rollback painel (Railway)

Mesmo fluxo, projeto **Painel-MDoctor**, serviço **painel-medico-staging**.

```powershell
cd mdoctor-panel
$env:RAILWAY_PROJECT_ID="3bec26a7-422e-40ae-8763-2a4c5158fef4"
$env:RAILWAY_ENVIRONMENT="staging"
$env:RAILWAY_SERVICE="painel-medico-staging"
railway deployment list --json
```

Validar: `https://painel-medico-staging-staging.up.railway.app/login` → 200.

**Env crítica painel:** `NEXT_PUBLIC_API_URL` deve apontar para o backend correto após rollback.

---

## 5. Rollback n8n workflow

### 5.1 Fonte da verdade

- Git: `docs/n8n-workflows/typebot-webhook-staging.json`
- Produção (separado): `docs/n8n-workflows/production/`

### 5.2 Procedimento

1. Identificar workflow ID no n8n staging (UI ou Postgres conforme runbooks existentes).
2. Importar JSON do commit **anterior estável** (`git checkout <tag> -- docs/n8n-workflows/...`).
3. Republicar workflow ativo.
4. Smoke:

```bash
N8N_WEBHOOK_SECRET=... node mdoctor-backend/scripts/probe-triagem-webhook-staging.js
```

**Nota:** webhook `typebot-webhook` pode retornar `200` com corpo vazio — validar criação no backend ou usar `POST /api/webhook/triagem` como fallback operacional documentado.

### 5.3 Rollback rápido operacional

- Desativar workflow problemático no n8n (toggle off).
- Entrada temporária: triagem direta no backend (somente operador técnico).

---

## 6. Rollback Typebot

1. Re-publicar versão anterior via Typebot UI ou:

```bash
TYPEBOT_API_TOKEN=... node mdoctor-backend/scripts/publish-typebot-production.js
```

2. Export de referência: `docs/typebot/typebot-doctor-prescreve-staging-safe.json` (staging) / `typebot-doctor-prescreve-production.json` (prod assistida).

3. Confirmar URL do webhook no fluxo aponta para n8n correto.

---

## 7. Rollback Supabase (dados)

**Evitar** rollback destrutivo de schema em produção assistida.

- Migrations: `mdoctor-backend/supabase/migrations/` — só forward com backup.
- Para incidente de dados: corrigir registro pontual via SQL supervisionado, não reverter migration inteira.

Backup: usar snapshots Supabase dashboard antes de go-live dia D.

---

## 8. Verificação pós-rollback

```bash
node mdoctor-backend/scripts/go-live-health-probe.js
node mdoctor-backend/scripts/fechar-fase2-staging.js   # se credenciais staging OK
```

| Check | Esperado |
|-------|----------|
| `/health` | 200 |
| `/readyz` | status ok ou warning aceitável |
| Login painel | 200 |
| Fila | carrega |
| Approve E2E | success (staging) |

---

## 9. Comunicação

Template:

```text
[Rollback Doctor Prescreve]
Serviço: <backend|painel|n8n>
Horário: <UTC-3>
Deployment revertido: <id>
Motivo: <1 linha>
Typebot: <pausado|ativo>
Ação médica: <não atender até OK>
Responsável: <nome>
```

---

## 10. Pós-mortem mínimo

- [ ] Timeline
- [ ] Causa raiz
- [ ] Deploy que introduziu falha
- [ ] Ação preventiva (teste E2E, alerta)
- [ ] Atualizar este documento se IDs mudarem
