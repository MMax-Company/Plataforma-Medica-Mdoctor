# Railway Staging Final Runbook - Doctor Prescreve

Data de fechamento: 2026-05-28

Este runbook encerra a preparacao de staging Railway do Doctor Prescreve. Ele e um guia de execucao manual assistida. Nao executar comandos Railway de criacao, variaveis ou deploy sem confirmacao manual explicita.

## 1. Objetivo do staging

- Validar o backend staging.
- Validar o painel staging.
- Validar o fluxo mock completo.
- Confirmar Supabase/Memed/WhatsApp em modo controlado.
- Nao mexer em producao.
- Nao usar dominio oficial.
- Nao ativar Memed real, WhatsApp real ou Stripe/pagamentos nesta etapa.

Repositorio:

```text
MMax-Company/Plataforma-Medica-Mdoctor
```

Branch:

```text
codex/legacy-compat-infra
```

## 2. Servicos Railway a criar

- `Backend-MDoctor-Staging`
- `Painel-MDoctor-Staging`

Criar os dois como servicos de staging separados. Nao reutilizar servicos de producao.

## 3. Backend staging

| Item | Valor |
| --- | --- |
| Repositorio | `MMax-Company/Plataforma-Medica-Mdoctor` |
| Branch | `codex/legacy-compat-infra` |
| Root directory | `mdoctor-backend` |
| Dockerfile | `mdoctor-backend/Dockerfile` |
| Start | `npm start` |
| Porta | `PORT` via Railway |
| Healthcheck | `/health` |
| Readiness | `/readyz` |

Envs minimas para smoke test mock:

| Variavel | Valor/acao |
| --- | --- |
| `NODE_ENV` | `staging` |
| `PORT` | `3004` ou valor injetado pelo Railway |
| `JWT_SECRET` | gerar segredo forte no Railway |
| `MEDICO_USER` | usuario staging |
| `MEDICO_PASS` | senha staging |
| `MEMED_ENV` | `mock` ou `development` |
| `DELIVERY_MOCK_ENABLED` | `true` |
| `WHATSAPP_ENABLED` | `false` |

Envs Supabase opcionais para staging real:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BUCKET_DOCUMENTS`
- `SUPABASE_BUCKET_PRESCRIPTIONS`
- `SUPABASE_BUCKET_MEDICAL_RECORDS`
- `SUPABASE_BUCKET_CONSENTS`
- `SUPABASE_BUCKET_LOGS`

Envs Memed opcionais:

- `MEMED_API_URL`
- `MEMED_API_KEY`
- `MEMED_SECRET_KEY`

Sem Supabase/Memed reais, o backend deve permanecer em mock/fallback e nao quebrar o painel.

## 4. Painel staging

| Item | Valor |
| --- | --- |
| Repositorio | `MMax-Company/Plataforma-Medica-Mdoctor` |
| Branch | `codex/legacy-compat-infra` |
| Root directory | `mdoctor-panel` |
| Dockerfile | `mdoctor-panel/Dockerfile` |
| Start | `npm start` |
| Healthcheck sugerido | `/login` |

Envs obrigatorias:

| Variavel | Valor/acao |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | URL publica do backend staging |
| `NEXT_PUBLIC_APP_ENV` | `staging` |
| `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK` | `true` |

Condicao importante: configurar `NEXT_PUBLIC_API_URL` antes do build do painel. Sem essa env, rotas antigas do painel podem cair em fallback de URL hardcoded e isso nao deve ser aceito para staging.

## 5. Ordem correta

1. Criar `Backend-MDoctor-Staging`.
2. Configurar envs do backend.
3. Deployar backend staging.
4. Testar `/health`.
5. Testar `/readyz`.
6. Copiar a URL publica do backend.
7. Criar `Painel-MDoctor-Staging`.
8. Configurar `NEXT_PUBLIC_API_URL` com a URL publica do backend staging.
9. Configurar `NEXT_PUBLIC_APP_ENV=staging`.
10. Configurar `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true`.
11. Deployar painel staging.
12. Testar `/login`.
13. Testar `/dashboard`.
14. Testar fluxo dashboard -> prontuario -> Memed -> receitas prontas -> entrega mock.
15. Atualizar `CORS_ORIGIN` no backend com a URL do painel staging, se necessario.
16. Redeployar apenas backend staging, se CORS for ajustado.

## 6. Supabase

Aplicar Supabase somente quando quiser persistencia real.

Passos:

1. Criar projeto Supabase separado de producao.
2. Aplicar `mdoctor-backend/supabase/migrations/20260527_backend_mvp_storage.sql`.
3. Criar buckets privados:
   - `documents`
   - `prescriptions`
   - `medical-records`
   - `consents`
   - `logs`
4. Configurar `SUPABASE_SERVICE_ROLE_KEY` somente no backend.
5. Nunca usar service role no painel.
6. Validar `/readyz`.

## 7. Memed

- Manter mock inicialmente.
- Validar `GET /api/prescriptions/:id`.
- Validar `POST /api/prescriptions/:id/generate`.
- Sandbox real somente depois que backend e painel staging estiverem OK.
- Nunca ativar Memed producao nesta etapa.

## 8. WhatsApp / n8n

- Fora desta etapa.
- Manter entrega mockada.
- Provider real somente depois do staging base validado.
- Nao apontar webhook de producao para staging.

## 9. Stripe / pagamentos

- Fora desta etapa.
- Nao ativar Stripe, Typebot ou pagamento real.
- Revisar `docs/PENDENCIAS-PAGAMENTOS-WHATSAPP.md` antes de qualquer fase de pagamento/WhatsApp.

## 10. Testes finais

Backend:

- `/health`
- `/readyz`
- `/api/auth/login`
- `/api/auth/me`
- `/api/atendimentos`
- `/api/prescriptions/:id`

Painel:

- `/login`
- `/dashboard`
- `/prontuario/[id]`
- `/memed/[id]`

Fluxo:

1. Login.
2. Dashboard.
3. Prontuario.
4. Memed mock.
5. Receita pronta.
6. Entrega mock.

## 11. Rollback

Se staging falhar:

1. Nao tocar producao.
2. Remover ou pausar apenas o servico staging com problema.
3. Voltar env alterada no servico staging.
4. Revalidar `/health` e `/readyz`.
5. Manter branch `codex/legacy-compat-infra` como referencia estavel.

## 12. Criterios para staging OK

- Backend sobe.
- `/health` OK.
- `/readyz` OK.
- Painel sobe.
- Login OK.
- Dashboard OK.
- Fluxo mock completo OK.
- Logs sem erro critico.
- `NEXT_PUBLIC_API_URL` aponta para backend staging.
- Producao intacta.

## 13. Comandos Railway - NAO EXECUTAR SEM CONFIRMACAO

Verificar login e contexto:

```bash
railway --version
railway whoami --json
railway project list --json
```

Criar/preparar backend:

```bash
railway link
railway add --service Backend-MDoctor-Staging
railway service Backend-MDoctor-Staging
railway variable set NODE_ENV=staging
railway variable set DELIVERY_MOCK_ENABLED=true
railway variable set WHATSAPP_ENABLED=false
railway variable set MEMED_ENV=mock
railway variable set LEGACY_COMPAT_ENABLED=true
railway variable set LEGACY_COMPAT_STRIPE=false
railway variable set LEGACY_COMPAT_TYPEBOT=false
```

Configurar manualmente no backend, com valores reais de staging revisados:

- `JWT_SECRET`
- `MEDICO_USER`
- `MEDICO_PASS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEMED_API_URL`
- `MEMED_API_KEY`
- `MEMED_SECRET_KEY`

Deploy backend, somente com confirmacao:

```bash
railway up --detach -m "Deploy backend staging"
```

Criar/preparar painel:

```bash
railway add --service Painel-MDoctor-Staging
railway service Painel-MDoctor-Staging
railway variable set NEXT_PUBLIC_APP_ENV=staging
railway variable set NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true
railway variable set NEXT_PUBLIC_API_URL=https://URL-DO-BACKEND-STAGING
```

Deploy painel, somente com confirmacao:

```bash
railway up --detach -m "Deploy painel staging"
```

Parada obrigatoria: nao executar `railway link`, `railway add`, `railway variable set` ou `railway up` sem confirmacao manual explicita.
