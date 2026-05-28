# Railway Staging - Execucao Passo a Passo

Este guia descreve a execucao manual do staging tecnico do Doctor Prescreve no Railway, sem tocar em producao.

Repositorio: `MMax-Company/Plataforma-Medica-Mdoctor`
Branch: `codex/legacy-compat-infra`

## A. Backend-MDoctor-Staging

1. Criar um novo servico no Railway chamado `Backend-MDoctor-Staging`.
2. Conectar o repositorio `MMax-Company/Plataforma-Medica-Mdoctor`.
3. Selecionar a branch `codex/legacy-compat-infra`.
4. Configurar root directory como `mdoctor-backend`.
5. Usar o Dockerfile existente em `mdoctor-backend/Dockerfile`.
6. Configurar healthcheck como `/health`.
7. Usar `/readyz` para validar readiness depois do deploy.

Comandos esperados:

- Build: definido pelo Dockerfile ou Nixpacks do Railway.
- Start: `npm start`.
- Porta: usar `PORT` fornecido pelo Railway.

Envs obrigatorias para staging real:

| Variavel | Onde configurar | Observacao |
| --- | --- | --- |
| `NODE_ENV` | Backend | Usar valor `staging`. |
| `JWT_SECRET` | Backend | Obrigatoria para JWT. Usar valor forte no Railway. |
| `MEDICO_USER` | Backend | Usuario local controlado para staging. |
| `MEDICO_PASS` | Backend | Senha local controlada para staging. |
| `SUPABASE_URL` | Backend | Obrigatoria para persistencia real. |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Somente backend. Nunca expor no painel. |

Envs opcionais ou que podem ficar em mock inicialmente:

| Variavel | Uso | Pode ficar vazia inicialmente |
| --- | --- | --- |
| `SUPABASE_ANON_KEY` | Compatibilidade/config Supabase | Sim |
| `SUPABASE_BUCKET_DOCUMENTS` | Storage de documentos | Sim |
| `SUPABASE_BUCKET_PRESCRIPTIONS` | Storage de receitas | Sim |
| `SUPABASE_BUCKET_MEDICAL_RECORDS` | Storage de prontuarios | Sim |
| `SUPABASE_BUCKET_CONSENTS` | Storage de consentimentos | Sim |
| `SUPABASE_BUCKET_LOGS` | Storage de logs | Sim |
| `MEMED_ENV` | Modo Memed | Sim, manter mock inicialmente |
| `MEMED_API_URL` | API Memed sandbox | Sim |
| `MEMED_API_KEY` | Credencial Memed sandbox | Sim |
| `MEMED_SECRET_KEY` | Secret Memed sandbox | Sim |
| `WHATSAPP_ENABLED` | Provider WhatsApp | Sim, manter desativado |

Validacao da URL publica do backend:

1. Abrir a URL publica gerada pelo Railway.
2. Testar `https://URL_BACKEND_STAGING/health`.
3. Testar `https://URL_BACKEND_STAGING/readyz`.
4. Confirmar que ambiente local/mock nao falha readiness quando Supabase, Memed ou WhatsApp ainda nao estiverem configurados.
5. Testar login em `POST /api/auth/login` com as credenciais configuradas no Railway.

## B. Painel-MDoctor-Staging

1. Criar um novo servico no Railway chamado `Painel-MDoctor-Staging`.
2. Conectar o mesmo repositorio `MMax-Company/Plataforma-Medica-Mdoctor`.
3. Selecionar a branch `codex/legacy-compat-infra`.
4. Configurar root directory como `mdoctor-panel`.
5. Usar o Dockerfile existente em `mdoctor-panel/Dockerfile`.
6. Configurar a URL publica do backend staging em `NEXT_PUBLIC_API_URL`.

Envs do painel:

| Variavel | Valor esperado |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | URL publica do `Backend-MDoctor-Staging` |
| `NEXT_PUBLIC_APP_ENV` | `staging` |
| `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK` | `true` |

Validacao do painel:

1. Abrir `https://URL_PAINEL_STAGING/login`.
2. Fazer login usando o backend staging.
3. Abrir `/dashboard`.
4. Validar fluxo: dashboard -> prontuario -> Memed -> receitas prontas.
5. Confirmar que fallback mock aparece de forma controlada quando Memed/WhatsApp real ainda nao estiverem ativos.

## C. Supabase

Supabase e opcional para o primeiro staging tecnico, mas obrigatorio para staging real com persistencia.

Passos:

1. Aplicar a migration em `mdoctor-backend/supabase/migrations`.
2. Criar ou validar os buckets privados:
   - `documents`
   - `prescriptions`
   - `medical-records`
   - `consents`
   - `logs`
3. Configurar `SUPABASE_URL` no backend.
4. Configurar `SUPABASE_SERVICE_ROLE_KEY` somente no backend.
5. Nunca colocar `SUPABASE_SERVICE_ROLE_KEY` no painel.
6. Validar `/readyz` para confirmar `supabase.configured` e `storage.mode`.

## D. Memed

1. Manter Memed em mock no primeiro staging.
2. Validar que `GET /api/prescriptions/:id` e `POST /api/prescriptions/:id/generate` retornam payload consistente com `source: "mock"` quando nao houver credenciais.
3. Ativar sandbox somente depois que backend e painel staging estiverem OK.

Envs de sandbox Memed:

- `MEMED_ENV`
- `MEMED_API_URL`
- `MEMED_API_KEY`
- `MEMED_SECRET_KEY`

Nao ativar credenciais de producao nesta fase.

## E. WhatsApp/N8N

1. Manter WhatsApp/n8n fora do primeiro staging.
2. Preservar entrega mockada pelo backend.
3. Documentar provider real como fase seguinte.
4. Nao conectar WhatsApp real antes de validar backend, painel, Supabase e Memed sandbox.

## F. Validacao Final

Backend:

- `GET /health`
- `GET /readyz`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/atendimentos`
- `GET /api/prescriptions/:id`

Painel:

- `/login`
- `/dashboard`
- `/prontuario/[id]`
- `/memed/[id]`

Fluxo operacional:

1. Login.
2. Dashboard.
3. Abrir prontuario.
4. Aprovar/seguir para Memed.
5. Gerar ou aceitar receita mock.
6. Ver receita em receitas prontas.
7. Enviar WhatsApp mockado.
8. Confirmar paciente fora das colunas operacionais quando entregue.

## G. Bloqueios

Antes de qualquer producao:

- Nao apontar dominio oficial para staging.
- Nao usar Railway de producao.
- Nao usar env real no frontend.
- Nao colocar service role no painel.
- Nao conectar WhatsApp real antes do staging estar validado.
- Nao ativar pagamento, Stripe ou Typebot nesta fase.
- Nao usar credenciais Memed de producao.
- Nao fazer merge para `main` sem revisao final.
