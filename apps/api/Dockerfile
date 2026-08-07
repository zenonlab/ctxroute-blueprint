FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/metadata/package.json packages/metadata/package.json
COPY packages/safe-http/package.json packages/safe-http/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY packages/progression/package.json packages/progression/package.json
COPY packages/sources/package.json packages/sources/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @favlib/api build
FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/metadata/package.json packages/metadata/package.json
COPY packages/safe-http/package.json packages/safe-http/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY packages/progression/package.json packages/progression/package.json
COPY packages/sources/package.json packages/sources/package.json
RUN pnpm install --prod --frozen-lockfile && apk add --no-cache age postgresql-client
COPY --chown=node:node packages packages
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
USER node
CMD ["node","apps/api/dist/src/server.js"]
