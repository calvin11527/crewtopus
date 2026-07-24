# syntax=docker/dockerfile:1
# Build context: src/ (monorepo root)

FROM node:20-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --workspace=crewtopus-backend --include-workspace-root

COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src
RUN npm run build --workspace=crewtopus-backend \
  && npm prune --omit=dev --workspace=crewtopus-backend

FROM node:20-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl libsqlite3-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./package.json
COPY --from=builder /app/backend/dist ./dist

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
  CMD curl -sf http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
