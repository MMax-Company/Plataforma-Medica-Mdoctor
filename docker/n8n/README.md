# n8n self-hosted (Docker Compose)

Stack local/servidor com **Public API** (`/api/v1`), volume persistente e geração de **API Key** na UI.

Integra com os scripts do repo (`mdoctor-backend/scripts/deploy-n8n-workflow.js`) via `N8N_BASE_URL` + `N8N_API_KEY`.

## Pré-requisitos

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) ou Docker Engine + Compose (Linux)
- Porta **5678** livre

## Instalação

```bash
cd docker/n8n

# 1) Variáveis
cp .env.example .env          # Linux/macOS
copy .env.example .env        # Windows CMD

# Edite .env: N8N_BASIC_AUTH_PASSWORD, N8N_ENCRYPTION_KEY (obrigatório)

# 2) Subir
docker compose up -d

# 3) Logs (opcional)
docker compose logs -f n8n
```

Gerar `N8N_ENCRYPTION_KEY` (PowerShell):

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
```

## Primeiro acesso

1. Abra **http://localhost:5678**
2. Informe **Basic Auth** (`N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` do `.env`)
3. Crie o **usuário owner** do n8n (primeira tela)
4. **Settings → n8n API** → **Create an API key**
5. Guarde a chave (só aparece uma vez) — use como `X-N8N-API-KEY`

> Se **Settings → n8n API** não aparecer: confira `N8N_PUBLIC_API_DISABLED=false` e reinicie (`docker compose up -d`).

## Testar a API

### Linux / macOS / Git Bash

Com **Basic Auth** ativo (`N8N_BASIC_AUTH_ACTIVE=true`), inclua também `-u admin:SUA_SENHA` (ou desative Basic Auth só em dev).

```bash
export N8N_API_KEY="cole_sua_chave_aqui"

curl -sS -X GET "http://localhost:5678/api/v1/workflows?limit=5" \
  -u "${N8N_BASIC_AUTH_USER:-admin}:${N8N_BASIC_AUTH_PASSWORD}" \
  -H "accept: application/json" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}"
```

### Windows PowerShell

```powershell
$env:N8N_API_KEY = "cole_sua_chave_aqui"
$pair = "admin:trocar_senha_segura"   # mesmo user/senha do .env
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))

Invoke-RestMethod `
  -Uri "http://localhost:5678/api/v1/workflows?limit=5" `
  -Headers @{
    accept = "application/json"
    Authorization = "Basic $basic"
    "X-N8N-API-KEY" = $env:N8N_API_KEY
  } | ConvertTo-Json -Depth 5
```

Ou com `curl.exe`:

```powershell
curl.exe -sS -X GET "http://localhost:5678/api/v1/workflows?limit=5" `
  -H "accept: application/json" `
  -H "X-N8N-API-KEY: $env:N8N_API_KEY"
```

### Swagger (opcional)

- **http://localhost:5678/api/v1/docs** — playground da Public API

### Health

```bash
curl -sS http://localhost:5678/healthz
```

## Usar com scripts do Mdoctor

**Validar `.env` + healthcheck:**

```powershell
node mdoctor-backend\scripts\verify-n8n-local-env.js
```

**Deploy automatizado (lê `docker/n8n/.env`, ativa workflow, valida webhook):**

```powershell
$env:N8N_API_KEY = "sua_chave_da_ui"   # ou defina N8N_API_KEY no .env
.\mdoctor-backend\scripts\deploy-n8n-workflow-local.ps1 `
  -WorkflowFile "docs\n8n-workflows\typebot-webhook-staging.json"
```

Saída esperada: `workflow criado` / `workflow atualizado`, `webhook ativo`, JSON de resumo.

**Node (Linux/macOS/Windows):**

```bash
node mdoctor-backend/scripts/deploy-n8n-workflow-local.js \
  docs/n8n-workflows/typebot-webhook-staging.json
```

**Bash / manual:**

```bash
export N8N_TARGET=local
export N8N_BASE_URL=http://localhost:5678
export N8N_API_KEY=sua_chave
export N8N_BASIC_AUTH_USER=admin
export N8N_BASIC_AUTH_PASSWORD=senha_do_env
export N8N_WORKFLOW_FILE=docs/n8n-workflows/typebot-webhook-staging.json
node mdoctor-backend/scripts/deploy-n8n-workflow.js
```

## Comandos úteis

| Ação | Comando |
|------|---------|
| Parar | `docker compose down` |
| Parar e apagar dados | `docker compose down -v` |
| Atualizar imagem | `docker compose pull && docker compose up -d` |
| Shell no volume | `docker volume inspect mdoctor_n8n_data` |

## Checklist — API `/api/v1/workflows`

- [ ] `docker compose ps` → serviço `mdoctor-n8n` **healthy** ou **running**
- [ ] `curl http://localhost:5678/healthz` → HTTP **200**
- [ ] UI abre em **http://localhost:5678** (após Basic Auth + owner criado)
- [ ] **Settings → n8n API** visível e permite **Create API key**
- [ ] `GET /api/v1/workflows` com header `X-N8N-API-KEY` → HTTP **200** (não 401/404)
- [ ] Corpo JSON contém lista (`data` ou array) com campos como `id`, `name`, `active`
- [ ] `GET /api/v1/workflows?active=true` filtra só workflows ativos
- [ ] Sem chave ou chave inválida → **401 Unauthorized**
- [ ] Após `docker compose restart`, workflows e credenciais **persistem** (volume `mdoctor_n8n_data`)

## Produção / servidor

No `.env`:

- `N8N_HOST`, `WEBHOOK_URL`, `N8N_EDITOR_BASE_URL` com domínio público **https**
- Reverse proxy (Traefik/Caddy/nginx) com TLS
- `N8N_BASIC_AUTH_ACTIVE=true` + firewall restrito
- Fixar versão da imagem: `docker.n8n.io/n8nio/n8n:2.22.5` em vez de `latest`

## Notas

| Variável | Observação |
|----------|------------|
| `N8N_PUBLIC_API_DISABLED=false` | Habilita `/api/v1` (padrão oficial é API ligada) |
| `N8N_API_KEY_ENABLED` | **Não consta na documentação oficial**; chaves são criadas na UI |
| `N8N_ENCRYPTION_KEY` | Sem ela fixa, credenciais podem ficar ilegíveis após recriar volume |
| Basic Auth | Protege editor; a Public API usa **X-N8N-API-KEY** após criar na UI |
