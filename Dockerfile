# syntax=docker/dockerfile:1.7
# awardgrid — one image for both the web app and the worker; docker-compose.yml picks the command.
#
# Build context must contain the vendored toolkit (vendor/travel-hacking-toolkit): `pnpm build:plugin`
# reads it. Clone with `git clone --recurse-submodules` (or `git submodule update --init`).
#
# Base is glibc (Debian bookworm) so the prebuilt better-sqlite3 / @node-rs/argon2 binaries load.
# Node 22 matches .nvmrc and package.json "engines".

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1 CI=true
# pnpm pinned to package.json "packageManager"; installed with npm so the build does not depend on
# corepack's signature keys being current in the base image.
RUN npm install -g pnpm@12.3.4
WORKDIR /app

# ---- deps: full install. Dev dependencies are needed here for `next build`, `drizzle-kit`, and
# for `tsx`, which the runtime image also uses to run the worker / migrate / admin CLIs. ----
FROM base AS deps
# Build toolchain only as a fallback for native modules whose prebuilt binary download fails
# (better-sqlite3 via prebuild-install). This stage is not part of the runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# The repo is a pnpm workspace since Phase 1 (docs/PIVOT.md §6). Every workspace member's
# manifest must be present before install, or the root's "@awardgrid/core": "workspace:*"
# cannot resolve. Manifest only — the sources arrive with the COPY . . in the build stage, so
# editing core code does not bust this cache layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile

# ---- build: pruned toolkit plugin (build/plugin) + Next standalone output (.next/standalone) ----
FROM deps AS build
COPY . .
RUN pnpm build:plugin && pnpm build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/awardgrid.db \
    AWARDGRID_DATA_DIR=/data \
    AWARDGRID_CACHE_DIR=/data/cache \
    AWARDGRID_PLUGIN_ROOT=/app/build/plugin
# curl: Docker HEALTHCHECK + the only network tool the ask-lane gate lets the toolkit skills run.
# jq: the kept skills pipe curl output through it. tini: PID 1 so SIGTERM reaches node.
RUN apt-get update && apt-get install -y --no-install-recommends curl jq ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data && chown -R node:node /data
WORKDIR /app

# Next standalone server: server.js + the built .next/ (server chunks, manifests, traced externals).
# The standalone directory's own traced node_modules is NOT copied — the full node_modules below is
# a superset, and copying both would merge two pnpm trees.
COPY --from=build --chown=node:node /app/.next/standalone/server.js ./server.js
COPY --from=build --chown=node:node /app/.next/standalone/.next ./.next
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# public/: the self-hosted Inter font (OFL) served by the standalone server.
COPY --from=build --chown=node:node /app/public ./public

# Full node_modules from the build stage: the worker, migrations and the admin CLI run TypeScript
# directly via node_modules/.bin/tsx (tsx is a devDependency, present because this is the complete
# install, not a production prune). Keep it that way.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
# Worker / CLI sources (tsx resolves "@/..." through tsconfig.json), drizzle migrations
# (src/lib/db/client.ts reads <cwd>/drizzle), built plugin, and LEGAL.md (rendered by /legal from
# <cwd>/LEGAL.md at request time).
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# packages/: node_modules/@awardgrid/core is a workspace SYMLINK into this directory. The Next
# server does not need it (transpilePackages bundles the core into the server chunks), but the
# worker and the CLIs run TypeScript through tsx and resolve "@awardgrid/core/*" at runtime, so
# without this the symlink dangles and `pnpm worker` dies on its first import.
# This also carries the places seed, which moved here from ./data in Phase 1 — ./data no longer
# exists in the build context at all, which is why it is no longer copied.
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/build/plugin ./build/plugin
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json /app/drizzle.config.ts /app/LEGAL.md ./

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
# app: apply migrations, then serve. The worker service overrides this command in docker-compose.yml.
CMD ["sh", "-c", "node_modules/.bin/tsx src/cli/migrate.ts && exec node server.js"]
