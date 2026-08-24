FROM oven/bun:1 AS builder
WORKDIR /app

ARG VERSION
ENV VERSION=${VERSION}

COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY ui/package.json ui/bun.lock ./ui/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd ui && bun install --frozen-lockfile

COPY . .

RUN if [ -z "$VERSION" ]; then VERSION=$(bun -p "require('./package.json').version"); fi; \
    bun run bump "$VERSION"

RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun run build:node

FROM node:22-slim

WORKDIR /app

# 复制构建产物与运行时依赖。
# --node 模式会保留对 node_modules 中 sharp / onnxruntime 外部原生模块(.node)的引用，
# 因此必须一并复制 node_modules 到运行镜像。
COPY --from=builder /app/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 健康检测依赖 curl（slim 基础镜像默认不含）
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV MT_HOST=0.0.0.0 \
    MT_PORT=8989 \
    NODE_ENV=production

EXPOSE 8989

CMD ["node", "main.js"]
