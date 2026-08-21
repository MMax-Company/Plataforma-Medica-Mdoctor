FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
# RAILWAY_ENVIRONMENT_NAME é o único sinal que distingue staging de produção
# durante o build — builds Docker no Railway só recebem variáveis do serviço
# se forem declaradas como ARG; sem isso, scripts/write-build-env.js nunca
# sabe em qual ambiente está compilando.
ARG RAILWAY_ENVIRONMENT_NAME
ENV RAILWAY_ENVIRONMENT_NAME=${RAILWAY_ENVIRONMENT_NAME}
# API_PROXY_TARGET, NEXT_PUBLIC_API_URL e NEXT_PUBLIC_APP_ENV NÃO são mais
# fixados aqui com default de staging — isso travava process.env antes do
# build e o Next.js nunca deixava scripts/write-build-env.js (que já calcula
# o valor certo por ambiente) sobrescrever. Esses três agora só existem via
# .env.production.local, gerado pelo prebuild.
ARG NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=false
ENV NEXT_PUBLIC_ENABLE_MOCK_FALLBACK=$NEXT_PUBLIC_ENABLE_MOCK_FALLBACK
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
