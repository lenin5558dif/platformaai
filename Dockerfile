FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ARG NODE_ENV=production
ARG NEXT_PUBLIC_APP_URL
ARG NEXTAUTH_URL=http://127.0.0.1:3000
ARG APP_URL=http://127.0.0.1:3000
ARG TELEGRAM_BOT_TOKEN=
ARG TELEGRAM_LOGIN_BOT_NAME=
ARG NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME=
ARG NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED=0
ARG NEXT_PUBLIC_SSO_ENABLED=1
ENV NODE_ENV=${NODE_ENV}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXTAUTH_URL=${NEXTAUTH_URL}
ENV APP_URL=${APP_URL}
ENV TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
ENV TELEGRAM_LOGIN_BOT_NAME=${TELEGRAM_LOGIN_BOT_NAME}
ENV NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME=${NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_NAME}
ENV NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED=${NEXT_PUBLIC_TELEGRAM_AUTH_ENABLED}
ENV NEXT_PUBLIC_SSO_ENABLED=${NEXT_PUBLIC_SSO_ENABLED}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run prisma:generate
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/platformaai \
  AUTH_SECRET=build-auth-secret \
  OPENROUTER_API_KEY=build-openrouter-key \
  UNISENDER_API_KEY=build-unisender-key \
  STRIPE_SECRET_KEY=sk_test_build_placeholder \
  STRIPE_WEBHOOK_SECRET=whsec_build_placeholder \
  npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]

FROM deps AS migrate
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]
