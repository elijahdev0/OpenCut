FROM oven/bun:alpine AS base

# Install dependencies and build the application
FROM base AS builder

WORKDIR /app

ARG FREESOUND_CLIENT_ID
ARG FREESOUND_API_KEY

COPY package.json package.json
COPY bun.lock bun.lock
COPY turbo.json turbo.json

COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/auth/package.json packages/auth/package.json

RUN bun install

COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
COPY apps/web/migrations apps/web/migrations
COPY apps/web/next.config.ts apps/web/next.config.ts
COPY apps/web/postcss.config.mjs apps/web/postcss.config.mjs
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/drizzle.config.ts apps/web/drizzle.config.ts
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/db/drizzle.config.ts packages/db/drizzle.config.ts
COPY packages/auth/src packages/auth/src

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
# Set build-time environment variables for validation
ENV DATABASE_URL="postgresql://opencut:opencutthegoat@localhost:5432/opencut"
ENV BETTER_AUTH_SECRET="build-time-secret"
ENV UPSTASH_REDIS_REST_URL="http://localhost:8079"
ENV UPSTASH_REDIS_REST_TOKEN="example_token"
ENV NEXT_PUBLIC_BETTER_AUTH_URL="http://localhost:3000"

ENV FREESOUND_CLIENT_ID=$FREESOUND_CLIENT_ID
ENV FREESOUND_API_KEY=$FREESOUND_API_KEY

# Optional features (leave empty to disable) — required at build time by env validation.
ENV CLOUDFLARE_ACCOUNT_ID=""
ENV R2_ACCESS_KEY_ID=""
ENV R2_SECRET_ACCESS_KEY=""
ENV R2_BUCKET_NAME=""
ENV MODAL_TRANSCRIPTION_URL=""

WORKDIR /app/apps/web
RUN bun run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

RUN chown nextjs:nodejs apps

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"


CMD ["bun", "apps/web/server.js"]

