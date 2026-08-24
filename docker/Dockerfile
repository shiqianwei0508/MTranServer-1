FROM harbor.gbim.vip/dockerio/oven/bun:1 AS builder
WORKDIR /app

ARG VERSION
ENV VERSION=${VERSION}

# 国内环境：bun 安装依赖使用 npmmirror 镜像源，避免访问官方 npm 源超时
ENV BUN_CONFIG_REGISTRY=https://registry.npmmirror.com

# 服务端镜像使用 docker/package.json（精简依赖清单），不含 electron / electron-builder
# / @fontsource 等桌面端或冗余依赖，因此不会触发 electron postinstall 从 GitHub
# 下载二进制（国内网络易报 connect ECONNREFUSED 20.205.243.166:443）。
# 桌面端打包请使用仓库根 package.json 在本地执行 electron:build。
# 配套 lock 为 docker/bun.lock（由 docker/package.json 生成），需同步维护。

COPY docker/package.json ./package.json
COPY docker/bun.lock ./bun.lock
RUN bun install --frozen-lockfile

COPY ui/package.json ui/bun.lock ./ui/
RUN cd ui && bun install --frozen-lockfile

COPY . .

RUN if [ -z "$VERSION" ]; then VERSION=$(bun -p "require('./package.json').version"); fi; \
    bun run bump "$VERSION"

RUN bun run build:node

# 构建完成后，移除 devDependencies（typescript/tsoa 等）及其独有传递依赖，
# 显著缩小最终镜像体积。
# 注意：bun install --production 不会删除已安装的 dev 包，必须用 prune 才能真正移除；
# prune --production 仅删 dev 部分，dependencies 与 optionalDependencies（如 @img/sharp-linux-x64）
# 均保留，不影响运行时加载。build:node 已将 sharp/onnxruntime 标记为 external，需由 node_modules 提供。
RUN bun prune --production

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

# 健康检测依赖 curl（slim 基础镜像默认不含）。
# 同时安装 fontconfig + 中文字体：sharp 在把翻译文字绘制回图片时通过 fontconfig 查找字体，
# 否则报 "Fontconfig error: Cannot load default config file" 且渲染出的文字为乱码。
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl fontconfig fonts-noto-cjk \
    && fc-cache -f \
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
