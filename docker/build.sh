#!/usr/bin/env bash
#
# MTranServer Docker 镜像构建脚本
#
# 用法:
#   ./docker/build.sh                 # 使用默认 tag: harbor.gbim.vip/freedo/mtranserver:latest
#   ./docker/build.sh myrepo/mt:1.0   # 自定义 tag
#
# 说明:
#   - Dockerfile 位于 docker/Dockerfile，构建上下文为仓库根目录（便于 COPY 整个源码）
#   - 构建时会执行 bun run build:node，原生依赖(sharp/onnxruntime)由 node_modules 自带，
#     无需在镜像内系统安装 ONNX Runtime
#   - 可选构建代理：设置环境变量 DOCKER_BUILD_PROXY（http/https 代理，如
#     DOCKER_BUILD_PROXY=http://127.0.0.1:7890 ./docker/build.sh），会通过
#     --build-arg BUILD_PROXY 传给 Dockerfile，供 bun install / apt 走代理。
#     不设置则完全不启用代理，镜像可移植性不受影响。
#     注意：bun / apt 不支持 socks5 代理，DOCKER_BUILD_PROXY 需为 http/https 协议；
#     基础镜像拉取（FROM 指令）不受此代理控制，需配置 docker daemon。
#
set -euo pipefail

# 回到仓库根目录作为构建上下文
cd "$(dirname "$0")/.."

TAG="${1:-harbor.gbim.vip/freedo/mtranserver:latest}"

# 可选透传构建代理
BUILD_ARGS=()
if [ -n "${DOCKER_BUILD_PROXY:-}" ]; then
  echo "==> 启用构建代理: ${DOCKER_BUILD_PROXY}"
  BUILD_ARGS=(--build-arg "BUILD_PROXY=${DOCKER_BUILD_PROXY}")
fi

# 构建日志默认用 --progress=plain，完整输出每个 RUN 层（含 bun install）的
# stdout/stderr，避免 BuildKit 默认 tty 进度格式把中间日志折叠吞掉。
# 需要恢复默认树状进度时设置 DOCKER_BUILD_PROGRESS=auto。
# legacy builder（未安装 buildx / 未启用 BuildKit 的旧 Docker）不支持 --progress，
# 自动检测并降级跳过该参数——其默认输出本就会完整打印 RUN 层日志，不影响查看。
PROGRESS="${DOCKER_BUILD_PROGRESS:-plain}"

if docker build --help 2>&1 | grep -q -- "--progress"; then
  BUILD_ARGS+=(--progress "${PROGRESS}")
  echo "==> Building MTranServer image: ${TAG} (--progress=${PROGRESS})"
else
  echo "==> Building MTranServer image: ${TAG} (legacy builder，无 --progress，自动降级)"
fi

docker build -f docker/Dockerfile -t "${TAG}" "${BUILD_ARGS[@]}" .

echo "==> Build complete."
echo "    启动: docker compose -f docker/docker-compose.yaml up -d"
echo "    或:   docker run -d -p 8989:8989 -v \"\$(pwd)/docker/models:/app/models\" ${TAG}"
