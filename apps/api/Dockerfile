FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --no-frozen-lockfile
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @favlib/api build
FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache age postgresql-client && corepack enable
COPY --from=build /app ./
CMD ["sh","-c","node apps/api/dist/src/migrate.js && exec node apps/api/dist/src/server.js"]
