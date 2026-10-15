# syntax=docker/dockerfile:1
# Production image for the Express API, in three stages:
#   deps     all npm dependencies, including the Prisma CLI and tsx (needed to build, migrate, seed)
#   build    generates the Prisma client and compiles TypeScript to dist/
#   runtime  production dependencies and dist/ only, running as the non-root `node` user
# docker-compose.prod.yml also uses the `build` stage as a one-off job that runs migrations and
# seeds the services, so the runtime image doesn't need the Prisma CLI.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the postinstall `prisma generate`; the build stage runs it explicitly.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# prisma.config.ts reads DATABASE_URL, but generating the client never connects to a database.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate \
    && npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
