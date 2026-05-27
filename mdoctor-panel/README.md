# MDoctor Panel

Painel medico operacional do Doctor Prescreve, separado do backend clinico. O MVP usa Next.js App Router, React, TypeScript, TailwindCSS, Zustand e uma camada de services preparada para consumir a API real com fallback mockado.

## Como rodar local

Instale as dependencias a partir da raiz do repositorio:

```bash
npm --prefix mdoctor-panel install
```

Crie o arquivo local de ambiente a partir do exemplo:

```bash
cp mdoctor-panel/.env.local.example mdoctor-panel/.env.local
```

O backend local esperado roda em:

```bash
http://localhost:3004
```

Variaveis locais esperadas:

```env
NEXT_PUBLIC_API_URL=http://localhost:3004
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true
```

Suba o painel:

```bash
npm --prefix mdoctor-panel run dev
```

Valide o build:

```bash
npm --prefix mdoctor-panel run build
```

## Backend local

O painel espera o `mdoctor-backend` em `localhost:3004`. Os endpoints reais usados no MVP estao documentados em `BACKEND_CONTRACT.md`.

Quando a API estiver offline, retornar erro, `401`, timeout ou payload vazio, o painel preserva fallback mockado para manter dashboard, prontuario, Memed visual e entrega simulada funcionando em desenvolvimento.

## Integracoes reais

Memed e WhatsApp reais ainda dependem do backend e das automacoes oficiais. O frontend nao chama WhatsApp direto e nao integra SDK Memed real nesta etapa.

## Deploy/Staging

O painel pode ser publicado em staging depois que o backend real estiver acessivel por URL publica ou interna do ambiente. A URL da API precisa ser definida antes do build, porque `NEXT_PUBLIC_*` e embutido no bundle do Next.js.

Variaveis esperadas:

```env
NEXT_PUBLIC_API_URL=https://url-do-backend-staging
NEXT_PUBLIC_APP_ENV=staging
NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true
```

Para producao inicial, usar `NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false` somente quando backend, autenticacao, Memed e entrega estiverem prontos para operar sem fallback visual.

Build:

```bash
npm --prefix mdoctor-panel run build
```

Docker:

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://url-do-backend-staging \
  --build-arg NEXT_PUBLIC_APP_ENV=staging \
  --build-arg NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=true \
  -t mdoctor-panel .
```

O Dockerfile nao copia `.env.local` e nao deve receber segredos. Memed e WhatsApp reais continuam responsabilidade do backend/automacoes; o painel apenas consome os endpoints expostos.
