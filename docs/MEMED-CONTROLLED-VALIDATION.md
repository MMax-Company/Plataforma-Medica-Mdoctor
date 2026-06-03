# Memed Controlled Validation - Staging

Data/hora: 2026-05-28 09:14 -03:00

## Escopo e restricoes

- Ambiente alvo: backend staging e painel staging.
- Sem alterar producao Railway.
- Sem ativar WhatsApp real.
- Sem ativar Stripe.
- Sem commit de secrets.
- Sem dados reais de paciente.
- Sem disparar prescricao para paciente real.

## Revisao tecnica rapida

Arquivos revisados:

- `mdoctor-backend/src/services/memed.service.js`
- `mdoctor-backend/src/routes/prescriptions.routes.js`
- `docs/RAILWAY-STAGING-RESULTADO.md`

Comportamento confirmado:

- Integracao Memed usa envs:
  - `MEMED_ENV`
  - `MEMED_API_URL`
  - `MEMED_API_KEY`
  - `MEMED_SECRET_KEY`
- Sem credenciais Memed validas, backend retorna receita mock.
- Em falha da Memed real, backend nao quebra o fluxo:
  - gera fallback mock
  - evita resposta 502 bruta no endpoint de geracao.

## Configuracao observada no backend staging

- `MEMED_ENV=mock`
- `MEMED_ENVIRONMENT=development`
- `MEMED_ENABLED=false`
- `MEMED_API_KEY` ausente
- `MEMED_SECRET_KEY` ausente

Leitura:

- Memed real nao estava habilitada para esta etapa.
- Modo seguro atual: mock controlado.

## Validacao executada (dados ficticios)

Base backend:

- `https://mdoctor-backend-staging-staging.up.railway.app`

Base painel:

- `https://painel-medico-staging-staging.up.railway.app`

Paciente de teste (ficticio):

- Nome: `Paciente Ficticio QA Memed`
- CPF: `12345678909` (teste)
- Telefone: `+5511999999999` (teste)
- Email: `qa.memed.staging+ficticio@example.com`

Resultado dos testes:

- `GET /health` -> `200`
- `GET /readyz` -> `200`
  - `storage.mode=supabase`
  - `supabase.connected=true`
  - `memed.source=mock`
  - `memed.env=mock`
- `POST /api/prescriptions/:id/generate` → **410** (descontinuado; usar fluxo widget + `/api/memed/receita`)
  - `success=true`
  - `source=mock`
  - `provider=mock`
  - `warning` de Memed nao configurada
- `GET /api/prescriptions/:id` -> `200`
  - `source=mock`
  - receita encontrada no storage (`storedId` presente)
- Painel staging:
  - `/login` -> `200`
  - `/dashboard` -> `200`

Controle de seguranca:

- Delivery real nao foi chamado.
- Nenhum endpoint de envio real (WhatsApp/provider) foi acionado.

## Procedimento para teste real controlado (somente com aprovacao explicita)

Se credenciais de producao Memed forem fornecidas manualmente:

1. Configurar apenas no backend staging:
   - `MEMED_API_URL`
   - `MEMED_API_KEY`
   - `MEMED_SECRET_KEY`
2. Definir `MEMED_ENV=production_controlled` (ou `production_staging`).
3. Redeploy somente `mdoctor-backend-staging`.
4. Rodar o mesmo fluxo com dados ficticios.
5. Confirmar retorno:
   - `source=memed` (se responder real) **ou**
   - fallback mock preservado (se falhar).
6. Manter proibido qualquer envio real para paciente real.

## Conclusao da validacao

- Memed real testada nesta etapa: **nao**.
- Dados ficticios usados: **sim**.
- Prescricao salva: **sim** (storage staging, provider mock).
- Fallback preservado: **sim**.
- Painel staging OK: **sim**.
- Producao Railway intacta: **sim**.
