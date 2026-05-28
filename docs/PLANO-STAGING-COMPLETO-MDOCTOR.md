# Plano Staging Completo - MDoctor

Plano operacional para preparar staging real do Doctor Prescreve sem alterar producao.

Repositorio oficial:

```text
MMax-Company/Plataforma-Medica-Mdoctor
```

Branch de staging:

```text
codex/legacy-compat-infra
```

Servicos esperados no Railway:

- `Backend-MDoctor-Staging`
- `Painel-MDoctor-Staging`

Nao usar `Mdoctor-Prescreve`, `doctor-repositorio-central` ou qualquer repositorio antigo.

## A. Supabase Staging

### Objetivo

Criar persistencia real isolada de producao, mantendo fallback local/mock ativo enquanto staging ainda estiver em validacao.

### Passos

1. Criar projeto Supabase separado para staging.
2. Aplicar a migration:

```text
mdoctor-backend/supabase/migrations/20260527_backend_mvp_storage.sql
```

3. Confirmar tabelas:
   - `patients`
   - `atendimentos`
   - `prescriptions`
   - `audit_logs`

4. Confirmar RLS habilitado nas tabelas.
5. Confirmar policies de acesso para `service_role`.
6. Criar/validar buckets privados:
   - `documents`
   - `prescriptions`
   - `medical-records`
   - `consents`
   - `logs`

### Variaveis Supabase no backend staging

Configurar somente no servico `Backend-MDoctor-Staging`:

| Variavel | Uso | Obrigatoria para staging real |
| --- | --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase staging | sim |
| `SUPABASE_ANON_KEY` | chave anon do projeto staging | recomendada |
| `SUPABASE_SERVICE_ROLE_KEY` | escrita/leitura backend com RLS | sim |
| `SUPABASE_BUCKET_DOCUMENTS` | bucket de documentos | sim |
| `SUPABASE_BUCKET_PRESCRIPTIONS` | bucket de receitas | sim |
| `SUPABASE_BUCKET_MEDICAL_RECORDS` | bucket de prontuarios | sim |
| `SUPABASE_BUCKET_CONSENTS` | bucket de consentimentos | sim |
| `SUPABASE_BUCKET_LOGS` | bucket de logs/auditoria | sim |

Para smoke test tecnico sem Supabase real, as credenciais podem ficar vazias e o backend deve permanecer em `fallback_local`.

### Validacao Supabase

Validar pelo backend:

```text
GET /readyz
```

Esperado:

- `storage.mode` indicando `supabase` quando configurado.
- `storage.mode` indicando `fallback_local` quando Supabase estiver vazio/indisponivel e fallback permitido.
- `supabase.configured` refletindo variaveis presentes.
- `supabase.connected` refletindo conectividade real.

Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` no painel, em variaveis `NEXT_PUBLIC_*`, logs, prints ou docs com valor real.

## B. Backend Staging

### Servico Railway

Nome:

```text
Backend-MDoctor-Staging
```

Root directory:

```text
mdoctor-backend
```

Dockerfile esperado:

```text
mdoctor-backend/Dockerfile
```

Comandos:

| Item | Valor |
| --- | --- |
| Build | `npm install` ou Dockerfile do backend |
| Start | `npm start` |
| Porta | `PORT` injetado pelo Railway |
| Healthcheck | `/health` |
| Readiness operacional | `/readyz` |

### Variaveis obrigatorias para smoke test

| Variavel | Observacao |
| --- | --- |
| `NODE_ENV` | usar `staging` |
| `ENVIRONMENT_NAME` | usar `staging` |
| `DATA_ENV` | usar `staging` |
| `PORT` | Railway injeta; `3004` e aceitavel em local/staging |
| `BASE_URL` | URL do backend staging |
| `CORS_ORIGIN` | URL do painel staging |
| `JWT_SECRET` | segredo forte configurado no Railway |
| `MEDICO_USER` | usuario medico staging |
| `MEDICO_PASS` | senha medico staging |
| `DISABLE_LOCAL_DB_FALLBACK` | `false` para smoke test; `true` apenas quando Supabase staging estiver validado |

### Variaveis opcionais/controladas

| Variavel | Staging inicial |
| --- | --- |
| `MEMED_ENABLED` | `false` |
| `MEMED_ENV` | `development` |
| `MEMED_API_URL` | sandbox/mock |
| `MEMED_API_KEY` | vazio se mock |
| `MEMED_SECRET_KEY` | vazio se mock |
| `WHATSAPP_ENABLED` | `false` |
| `DELIVERY_MOCK_ENABLED` | `true` |
| `LEGACY_COMPAT_ENABLED` | `true` se validar aliases |
| `LEGACY_COMPAT_STRIPE` | `false` |
| `LEGACY_COMPAT_TYPEBOT` | `false` |
| `STRIPE_SECRET_KEY` | vazio |
| `STRIPE_WEBHOOK_SECRET` | vazio |
| `TYPEBOT_WEBHOOK_SECRET` | vazio ate fase propria |

### Validacao backend

Validar depois do deploy:

```text
GET /health
GET /readyz
POST /api/auth/login
GET /api/auth/me
GET /api/atendimentos
GET /api/atendimentos/:id
PATCH /api/atendimentos/:id/status
GET /api/prescriptions/:id
POST /api/prescriptions/:id/generate
POST /api/atendimentos/:id/deliver
```

## C. Painel Staging

### Servico Railway

Nome:

```text
Painel-MDoctor-Staging
```

Root directory:

```text
mdoctor-panel
```

Dockerfile esperado:

```text
mdoctor-panel/Dockerfile
```

Comandos:

| Item | Valor |
| --- | --- |
| Build | Dockerfile / `npm run build` |
| Start | `npm start` |
| Healthcheck | `/login` |

### Variaveis do painel

Configurar antes do build:

| Variavel | Valor |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | URL do `Backend-MDoctor-Staging` |
| `NEXT_PUBLIC_APP_ENV` | `staging` |
| `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK` | `true` para staging tecnico |

O painel nao deve receber:

- `SUPABASE_SERVICE_ROLE_KEY`
- chaves Memed secretas
- chaves Stripe
- tokens WhatsApp
- qualquer segredo server-side

### Validacao painel

Validar:

```text
GET /login
GET /dashboard
```

Fluxo minimo:

1. Login staging.
2. Abrir dashboard.
3. Atender paciente.
4. Abrir prontuario.
5. Aprovar.
6. Abrir tela Memed mock/sandbox.
7. Aceitar receita.
8. Enviar WhatsApp mock.
9. Confirmar que paciente sai das colunas operacionais como `delivered`.

## D. Memed

### Staging inicial

Memed deve permanecer em mock quando credenciais nao estiverem configuradas.

Comportamento esperado:

- `GET /api/prescriptions/:id` retorna payload consistente.
- `POST /api/prescriptions/:id/generate` retorna `source: "mock"` quando Memed nao estiver configurada.
- Nenhum `502` bruto deve chegar ao frontend.
- `/readyz` deve indicar estado Memed de forma controlada.

### Sandbox futura

Quando houver credenciais sandbox:

| Variavel | Uso |
| --- | --- |
| `MEMED_ENABLED` | habilitar fluxo controlado |
| `MEMED_ENV` | `development` ou sandbox |
| `MEMED_API_URL` | URL sandbox |
| `MEMED_API_KEY` | chave sandbox |
| `MEMED_SECRET_KEY` | segredo sandbox |
| `MEMED_TIMEOUT_MS` | timeout de integracao |

Nao ativar `MEMED_ENV=production` antes de staging sandbox validado ponta a ponta.

## E. WhatsApp / n8n

WhatsApp real e n8n ficam fora do staging inicial.

Staging inicial:

- `WHATSAPP_ENABLED` desligado.
- `DELIVERY_MOCK_ENABLED` ligado.
- Entrega mockada via backend.
- Painel nao envia WhatsApp diretamente.

Fase futura:

1. Definir provider real ou n8n.
2. Criar secrets proprios de staging.
3. Configurar webhook staging separado.
4. Validar logs e idempotencia.
5. So depois considerar producao.

Nao apontar webhook de producao para staging.

## F. Ordem de execucao

1. Aplicar Supabase staging, se o objetivo for persistencia real.
2. Criar `Backend-MDoctor-Staging`.
3. Configurar envs do backend.
4. Deployar backend staging.
5. Validar `/health` e `/readyz`.
6. Validar login e endpoints clinicos.
7. Criar `Painel-MDoctor-Staging`.
8. Configurar `NEXT_PUBLIC_API_URL` apontando para backend staging.
9. Deployar painel staging.
10. Atualizar `CORS_ORIGIN` no backend com URL do painel staging.
11. Redeployar backend staging se necessario.
12. Validar login, dashboard, prontuario, Memed mock e entrega mock.
13. Revisar logs.
14. So depois pensar em producao.

## G. Checklist de bloqueio antes de producao

Nao avancar para producao sem:

- Supabase real aplicado e validado.
- Buckets reais criados.
- `SUPABASE_SERVICE_ROLE_KEY` apenas no backend.
- `DISABLE_LOCAL_DB_FALLBACK=true` validado em ambiente real.
- Memed sandbox validada.
- WhatsApp/provider real validado.
- Logs sem erro critico.
- Painel staging validado.
- Backend staging validado.
- CORS restrito ao dominio correto.
- Nenhum segredo no frontend.
- Nenhum `.env` real commitado.
- Rollback definido.
- Dominios de producao preservados ate aprovacao final.

## Validacoes locais antes de mexer no Railway

Rodar:

```bash
npm --prefix mdoctor-backend run check
npm --prefix mdoctor-panel run build
npm --prefix mdoctor-panel run lint
npm run pre-github-check
```

Aceitavel:

- Lint com warnings antigos ja conhecidos, sem erros.

Bloqueante:

- Check backend falhando.
- Build painel falhando.
- `pre-github-check` apontando segredo real.
- Working tree suja com codigo funcional nao revisado.

## Proibido nesta fase

- Alterar producao.
- Reutilizar servico production no Railway.
- Usar dominio oficial.
- Ativar Stripe live.
- Ativar Memed production.
- Ativar WhatsApp real.
- Colar service role no painel.
- Abrir PR sem revisao.
- Fazer deploy sem checklist manual.
