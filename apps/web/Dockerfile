FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web/app apps/web/app
COPY apps/web/public apps/web/public
COPY apps/web/next-env.d.ts apps/web/next-env.d.ts
COPY apps/web/next.config.ts apps/web/next.config.ts
COPY apps/web/playwright.config.ts apps/web/playwright.config.ts
COPY apps/web/tsconfig.json apps/web/tsconfig.json
RUN pnpm --filter @favlib/web build
FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
CMD ["node","apps/web/server.js"]
