FROM harbor.gbim.vip/dockerio/oven/bun:1 AS builder
WORKDIR /app

ARG VERSION
ENV VERSION=${VERSION}

# 国内环境：bun 安装依赖使用 npmmirror 镜像源，避免访问官方 npm 源超时
ENV BUN_CONFIG_REGISTRY=https://registry.npmmirror.com

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

FROM harbor.gbim.vip/dockerio/node:22-slim

WORKDIR /app

# 复制构建产物与运行时依赖。
# --node 模式会保留对 node_modules 中 sharp / onnxruntime 外部原生模块(.node)的引用，
# 因此必须一并复制 node_modules 到运行镜像。
COPY --from=builder /app/dist ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 国内环境：将 apt 官方源替换为阿里云镜像，加速 curl 等依赖安装
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true

# 健康检测依赖 curl（slim 基础镜像默认不含）
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# 以非 root 用户运行（对应 Kylin 部署文档 service 中的 User=freedo）。
# 基础镜像为 Debian (node:22-slim)，使用 useradd/groupadd（来自 shadow 包，slim 自带）；
# 固定 UID/GID=1000，便于与宿主机挂载卷权限对齐。
RUN groupadd -g 1000 freedo \
    && useradd -u 1000 -g freedo -M -s /usr/sbin/nologin freedo \
    && mkdir -p /app/models \
    && chown -R freedo:freedo /app

# 切换非 root 用户
USER freedo

ENV MT_HOST=0.0.0.0 \
    MT_PORT=8989 \
    MT_MODEL_DIR=/app/models \
    NODE_ENV=production

EXPOSE 8989

CMD ["node", "main.js"]
