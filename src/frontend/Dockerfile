# syntax=docker/dockerfile:1
# Build context: src/ (monorepo root)

FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=crewtopus-frontend --include-workspace-root

COPY frontend/index.html frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.node.json ./frontend/
COPY frontend/public ./frontend/public
COPY frontend/src ./frontend/src
RUN npm run build --workspace=crewtopus-frontend

FROM nginx:1.27-alpine AS runtime

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=10s \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
