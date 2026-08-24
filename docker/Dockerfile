FROM harbor.gbim.vip/dockerio/oven/bun:1 AS builder
WORKDIR /app

ARG VERSION
ENV VERSION=${VERSION}

# 国内环境：bun 安装依赖使用 npmmirror 镜像源，避免访问官方 npm 源超时
ENV BUN_CONFIG_REGISTRY=https://registry.npmmirror.com

# 可选构建代理（默认不设置，不硬编码内网地址以保证镜像可移植性）。
# 用法：docker build --build-arg BUILD_PROXY=http://user:pass@proxy:port ...
# 说明：
#   - bun install / apt 均不支持 socks5 代理，请提供 http/https 代理端口；
#   - 未传 BUILD_PROXY 时各环境变量为空，工具自动忽略，行为与现在完全一致；
#   - 基础镜像（FROM 的 oven/bun、node:22-slim）拉取发生在 docker daemon 层，
#     不受本 ARG 控制，需在 daemon 配置 registry mirror / proxy。
ARG BUILD_PROXY
ENV HTTP_PROXY=${BUILD_PROXY} \
    HTTPS_PROXY=${BUILD_PROXY} \
    http_proxy=${BUILD_PROXY} \
    https_proxy=${BUILD_PROXY} \
    NO_PROXY=localhost,127.0.0.1,::1

# 服务端镜像使用 docker/package.json（精简依赖清单），不含 electron / electron-builder
# / @fontsource 等桌面端或冗余依赖，因此不会触发 electron postinstall 从 GitHub
# 下载二进制（国内网络易报 connect ECONNREFUSED 20.205.243.166:443）。
# 桌面端打包请使用仓库根 package.json 在本地执行 electron:build。
# 配套 lock 为 docker/bun.lock（由 docker/package.json 生成），需同步维护。
#
# 缓存说明：docker/package.json 的 version 字段固定为 1.0.0，不随仓库版本号 bump。
# bun.lock 的 root 条目不记录 version，依赖解析不受影响；反之，若每次 bump 版本号
# 都改动该文件，COPY 层哈希变化会导致紧随其后的 RUN bun install 层缓存失效，
# 每次构建都会重新安装依赖。请勿修改此 version 字段。

COPY docker/package.json ./package.json
COPY docker/bun.lock ./bun.lock
# 默认静默安装（bun 在非 TTY 下无过程输出，只打印一行摘要），避免日志刷屏。
# 需要排查依赖下载 / 网络问题时，构建时传 --build-arg BUN_VERBOSE=--verbose
# （build.sh 可用 DOCKER_BUILD_VERBOSE=1 一键开启），逐包打印下载/解压详情。
# 仅影响日志级别，不影响 --frozen-lockfile 的解析与缓存命中。
ARG BUN_VERBOSE=""
RUN bun install --frozen-lockfile $BUN_VERBOSE

COPY ui/package.json ui/bun.lock ./ui/
RUN cd ui && bun install --frozen-lockfile $BUN_VERBOSE

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
