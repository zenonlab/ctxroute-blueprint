FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --no-frozen-lockfile
COPY apps/web apps/web
RUN pnpm --filter @favlib/web build
CMD ["sh","-c","cd /app/apps/web && exec node_modules/.bin/next start -p 3000"]
