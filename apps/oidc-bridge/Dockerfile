# Build context = thư mục gốc repo (cần pnpm-lock.yaml + workspace).
#   docker build -f apps/oidc-bridge/Dockerfile .
# Runtime chỉ có JS đã build + dependency production: không tsx, không TypeScript.
FROM node:22.23-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

# Manifest trước, source sau: đổi code không làm cài lại dependency.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/oidc-bridge/package.json apps/oidc-bridge/
COPY packages/app-database/package.json packages/app-database/
RUN pnpm install --frozen-lockfile --filter @hd-document/oidc-bridge...

COPY apps/oidc-bridge/tsconfig.json apps/oidc-bridge/tsconfig.build.json apps/oidc-bridge/
COPY apps/oidc-bridge/src apps/oidc-bridge/src
RUN pnpm --filter @hd-document/oidc-bridge build
# Gom dist + node_modules production (không symlink ra ngoài) vào /out.
RUN pnpm --filter @hd-document/oidc-bridge deploy --prod --legacy /out

FROM node:22.23-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 4001
CMD ["node", "dist/server.js"]
