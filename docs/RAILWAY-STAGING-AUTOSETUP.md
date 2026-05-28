# Railway Staging Autosetup - Doctor Prescreve

Este documento prepara um setup semi-automatizado para staging Railway, mas para antes de qualquer deploy real.

Nao executar comandos de criacao, variaveis ou deploy sem confirmacao manual.

Repositorio correto:

```text
MMax-Company/Plataforma-Medica-Mdoctor
```

Branch:

```text
codex/legacy-compat-infra
```

Servicos planejados:

- `Backend-MDoctor-Staging`
- `Painel-MDoctor-Staging`

## 1. Precheck local

Comandos seguros de leitura:

```bash
git status
git branch --show-current
git log --oneline -10
railway --version
railway whoami --json
```

Resultado esperado:

- Working tree limpo.
- Branch `codex/legacy-compat-infra`.
- Railway CLI instalado.
- Usuario Railway autenticado.
- Dockerfiles presentes em `mdoctor-backend` e `mdoctor-panel`.
- `package.json` dos dois servicos com scripts validos.

## 2. Backend-MDoctor-Staging

Configuracao esperada:

| Item | Valor |
| --- | --- |
| Nome do servico | `Backend-MDoctor-Staging` |
| Repositorio | `MMax-Company/Plataforma-Medica-Mdoctor` |
| Branch | `codex/legacy-compat-infra` |
| Root directory | `mdoctor-backend` |
| Dockerfile | `mdoctor-backend/Dockerfile` |
| Build | Dockerfile / `npm install --omit=dev` |
| Start | `npm start` |
| Porta | `PORT` injetado pelo Railway |
| Healthcheck | `/health` |
| Readiness | `/readyz` |

Scripts confirmados no backend:

- `start`: `node server.js`
- `dev`: `nodemon server.js`
- `check`: `node --check ...`

Variaveis do backend:

| Variavel | Classificacao | Pode ficar mock/vazia inicialmente | Observacao |
| --- | --- | --- | --- |
| `NODE_ENV` | obrigatoria | nao | Usar `staging`. |
| `PORT` | obrigatoria | Railway injeta | Nao fixar se Railway ja injetar. |
| `JWT_SECRET` | obrigatoria | nao | Valor forte apenas no Railway. |
| `MEDICO_USER` | obrigatoria | nao | Usuario staging. |
| `MEDICO_PASS` | obrigatoria | nao | Senha staging. |
| `SUPABASE_URL` | obrigatoria para persistencia real | sim | Pode ficar vazia no smoke test com fallback. |
| `SUPABASE_ANON_KEY` | recomendada para Supabase real | sim | Nao usar no painel como service role. |
| `SUPABASE_SERVICE_ROLE_KEY` | obrigatoria para Supabase real | sim | Somente backend. |
| `SUPABASE_BUCKET_DOCUMENTS` | opcional inicial | sim | Usar `documents` quando storage real estiver pronto. |
| `SUPABASE_BUCKET_PRESCRIPTIONS` | opcional inicial | sim | Usar `prescriptions`. |
| `SUPABASE_BUCKET_MEDICAL_RECORDS` | opcional inicial | sim | Usar `medical-records`. |
| `SUPABASE_BUCKET_CONSENTS` | opcional inicial | sim | Usar `consents`. |
| `SUPABASE_BUCKET_LOGS` | opcional inicial | sim | Usar `logs`. |
| `MEMED_ENV` | opcional inicial | sim | Manter mock/desenvolvimento inicialmente. |
| `MEMED_API_URL` | opcional inicial | sim | Sandbox apenas depois do smoke test. |
| `MEMED_API_KEY` | opcional inicial | sim | Sem credencial real no primeiro staging. |
| `MEMED_SECRET_KEY` | opcional inicial | sim | Sem credencial real no primeiro staging. |
| `WHATSAPP_ENABLED` | opcional inicial | sim | Manter desligado. |
| `DELIVERY_MOCK_ENABLED` | recomendada | nao | Usar `true` no staging tecnico. |

Comandos Railway preparados para o backend, para executar somente depois de confirmacao:

```bash
railway link
railway add --service Backend-MDoctor-Staging
railway service Backend-MDoctor-Staging
railway variable set NODE_ENV=staging
railway variable set DELIVERY_MOCK_ENABLED=true
railway variable set WHATSAPP_ENABLED=false
railway variable set MEMED_ENV=development
railway variable set LEGACY_COMPAT_ENABLED=true
railway variable set LEGACY_COMPAT_STRIPE=false
railway variable set LEGACY_COMPAT_TYPEBOT=false
```

Variaveis sensiveis devem ser configuradas manualmente no painel Railway ou por CLI somente com valores reais revisados:

- `JWT_SECRET`
- `MEDICO_USER`
- `MEDICO_PASS`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEMED_API_URL`
- `MEMED_API_KEY`
- `MEMED_SECRET_KEY`

Deploy backend, somente depois de confirmacao:

```bash
railway up --detach -m "Deploy backend staging"
```

Validacao backend:

```bash
curl https://URL_BACKEND_STAGING/health
curl https://URL_BACKEND_STAGING/readyz
```

Validacoes funcionais:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/atendimentos`
- `GET /api/atendimentos/:id`
- `GET /api/prescriptions/:id`
- `POST /api/prescriptions/:id/generate`
- `POST /api/atendimentos/:id/deliver`

## 3. Painel-MDoctor-Staging

Configuracao esperada:

| Item | Valor |
| --- | --- |
| Nome do servico | `Painel-MDoctor-Staging` |
| Repositorio | `MMax-Company/Plataforma-Medica-Mdoctor` |
| Branch | `codex/legacy-compat-infra` |
| Root directory | `mdoctor-panel` |
| Dockerfile | `mdoctor-panel/Dockerfile` |
| Build | Dockerfile / `npm ci` e `npm run build` |
| Start | `npm start` |
| Porta | `3000` no container, Railway roteia externamente |
| Healthcheck sugerido | `/login` |

Scripts confirmados no painel:

- `dev`: `next dev`
- `build`: `next build`
- `start`: `next start`
- `lint`: `eslint .`

Variaveis do painel:

| Variavel | Classificacao | Observacao |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | obrigatoria | URL publica do backend staging. |
| `NEXT_PUBLIC_APP_ENV` | obrigatoria | Usar `staging`. |
| `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK` | recomendada no staging tecnico | Usar `true`. |

O painel nao deve receber:

- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `MEDICO_PASS`
- chaves Memed secretas
- tokens WhatsApp
- chaves Stripe

Comandos Railway preparados para o painel, para executar somente depois de confirmacao:

```bash
railway add --service Painel-MDoctor-Staging
railway service Painel-MDoctor-Staging
railway variable set NEXT_PUBLIC_APP_ENV=staging
railway variable set NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true
railway variable set NEXT_PUBLIC_API_URL=https://URL_BACKEND_STAGING
```

Deploy painel, somente depois de confirmacao:

```bash
railway up --detach -m "Deploy painel staging"
```

Validacao painel:

- `https://URL_PAINEL_STAGING/login`
- `https://URL_PAINEL_STAGING/dashboard`
- fluxo dashboard -> prontuario -> Memed -> receitas prontas

Depois que a URL do painel existir:

1. Atualizar `CORS_ORIGIN` no backend staging com a URL do painel.
2. Redeployar somente o backend staging se necessario.
3. Revalidar login pelo painel.

## 4. Supabase staging

Supabase real e opcional para o primeiro smoke test, mas obrigatorio para staging com persistencia.

Passos:

1. Criar projeto Supabase separado de producao.
2. Aplicar a migration:

```text
mdoctor-backend/supabase/migrations/20260527_backend_mvp_storage.sql
```

3. Criar ou validar os buckets privados:

- `documents`
- `prescriptions`
- `medical-records`
- `consents`
- `logs`

4. Configurar `SUPABASE_URL` no backend staging.
5. Configurar `SUPABASE_SERVICE_ROLE_KEY` somente no backend staging.
6. Nunca configurar service role no painel.
7. Validar `/readyz`.

## 5. Memed

Staging inicial:

- manter mock
- nao usar credenciais de producao
- validar `source: "mock"` em prescriptions
- validar `POST /api/prescriptions/:id/generate`

Sandbox futura:

- configurar `MEMED_ENV`
- configurar `MEMED_API_URL`
- configurar `MEMED_API_KEY`
- configurar `MEMED_SECRET_KEY`
- validar sandbox somente depois do backend e painel staging estarem OK

## 6. WhatsApp e n8n

Staging inicial:

- manter `WHATSAPP_ENABLED` desligado
- manter entrega mockada
- nao conectar provider real
- nao apontar webhook de producao para staging

Fase seguinte:

1. Criar provider/n8n separado para staging.
2. Configurar secrets de staging.
3. Validar webhook isolado.
4. Validar logs e idempotencia.
5. So depois planejar producao.

## 7. Rollback basico

Se backend staging falhar:

1. Verificar logs do servico `Backend-MDoctor-Staging`.
2. Confirmar envs obrigatorias.
3. Confirmar root directory `mdoctor-backend`.
4. Confirmar healthcheck `/health`.
5. Voltar para fallback local com Supabase vazio e `DELIVERY_MOCK_ENABLED=true`.

Se painel staging falhar:

1. Verificar logs do servico `Painel-MDoctor-Staging`.
2. Confirmar `NEXT_PUBLIC_API_URL`.
3. Confirmar root directory `mdoctor-panel`.
4. Rebuildar depois de ajustar envs `NEXT_PUBLIC_*`.

Nao mexer em producao durante rollback de staging.

## 8. Checklist final antes de deploy assistido

- [ ] Git clean.
- [ ] Branch `codex/legacy-compat-infra`.
- [ ] Railway CLI instalado.
- [ ] Railway login ativo.
- [ ] Backend check local passou.
- [ ] Painel build local passou.
- [ ] `pre-github-check` passou.
- [ ] Servicos staging separados dos servicos de producao.
- [ ] Nenhum dominio oficial apontado para staging.
- [ ] Nenhum segredo colocado no painel.
- [ ] Memed production nao ativada.
- [ ] WhatsApp real nao ativado.
- [ ] Stripe/Typebot nao ativados.

## 9. Parada obrigatoria

Parar aqui e pedir confirmacao antes de executar qualquer comando que crie, configure ou faça deploy real no Railway:

- `railway link`
- `railway add`
- `railway variable set`
- `railway up`
- qualquer comando de deploy
