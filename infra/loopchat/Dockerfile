# Imagen única de Loopchat: sirve la app (next start), el worker y las migraciones.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Variables mínimas solo para compilar (no se usan en runtime)
RUN DATABASE_URL=postgres://build@localhost/build BETTER_AUTH_SECRET=build-only-secret-build-only-secret-xx LOOPCHAT_ENCRYPTION_KEYS=b:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# /data/storage: el volumen nombrado hereda dueño y permisos de este directorio (si no, queda de root y loopchat no puede escribir)
# pg_dump/pg_restore 16 del repositorio oficial PGDG: el de Debian (15) se niega a volcar las bases (PostgreSQL 16)
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-common openssl rclone ca-certificates \
  && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 1001 loopchat \
  && mkdir -p /data/storage && chown loopchat:loopchat /data/storage
COPY --from=build --chown=loopchat /app ./
USER loopchat
EXPOSE 3000
CMD ["npm", "run", "start"]
