FROM harbor.gbim.vip/dockerio/oven/bun:1 AS builder
WORKDIR /app

ARG VERSION
ENV VERSION=${VERSION}

# 国内环境：bun 安装依赖使用 npmmirror 镜像源，避免访问官方 npm 源超时
ENV BUN_CONFIG_REGISTRY=https://registry.npmmirror.com

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY ui/package.json ui/bun.lock ./ui/
RUN cd ui && bun install --frozen-lockfile

COPY . .

RUN if [ -z "$VERSION" ]; then VERSION=$(bun -p "require('./package.json').version"); fi; \
    bun run bump "$VERSION"

RUN bun run build:node

# 构建完成后，仅保留运行时依赖（移除 devDependencies 如 electron/typescript/tsoa 等），
# 显著缩小最终镜像体积。运行时所需包(sharp/onnxruntime/express 等)均在 dependencies 中，
# build:node 已将其标记为 external，--production 不会误删。
RUN bun install --frozen-lockfile --production

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

# 以非 root 用户运行。node:22-slim 基础镜像已自带非 root 用户 node (UID/GID=1000)，
# 直接复用它，避免新建用户时与已存在的 UID/GID 1000 冲突。
# 对应 Kylin 物理机部署中 systemd 的 User=freedo（均为非 root 运行）。
RUN mkdir -p /app/models \
    && chown -R node:node /app

# 切换非 root 用户
USER node

ENV MT_HOST=0.0.0.0 \
    MT_PORT=8989 \
    MT_MODEL_DIR=/app/models \
    NODE_ENV=production

EXPOSE 8989

CMD ["node", "main.js"]
