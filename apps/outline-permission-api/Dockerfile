# Build context = thư mục gốc repo (cần pnpm-lock.yaml + workspace).
#   docker build -f apps/outline-permission-api/Dockerfile .
# Runtime chỉ có JS đã build + dependency production: không tsx, không TypeScript.
FROM node:22.23-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

# Manifest trước, source sau: đổi code không làm cài lại dependency.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/outline-permission-api/package.json apps/outline-permission-api/
COPY packages/app-database/package.json packages/app-database/
COPY packages/outline-api-client/package.json packages/outline-api-client/
RUN pnpm install --frozen-lockfile --filter @hd-document/outline-permission-api...

COPY apps/outline-permission-api/tsconfig.json apps/outline-permission-api/tsconfig.build.json apps/outline-permission-api/
COPY apps/outline-permission-api/src apps/outline-permission-api/src
COPY packages/app-database packages/app-database
COPY packages/outline-api-client packages/outline-api-client
RUN pnpm --filter @hd-document/outline-permission-api build
# Package workspace export src/*.ts cho dev; Node từ chối strip type trong
# node_modules → build ra dist và trỏ exports sang đó trước khi deploy.
# Làm SAU khi build app: tsc của app lấy type từ src (dist không có .d.ts).
RUN pnpm --filter @hd-document/outline-api-client build \
  && node --input-type=commonjs -e 'const f="packages/outline-api-client/package.json";const p=require("./"+f);p.exports={".":"./dist/index.js"};require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")'
# Gom dist + node_modules production (không symlink ra ngoài) vào /out.
RUN pnpm --filter @hd-document/outline-permission-api deploy --prod --legacy /out

FROM node:22.23-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 4100
CMD ["node", "dist/server.js"]
