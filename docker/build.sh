#!/usr/bin/env bash
#
# MTranServer Docker 镜像构建脚本
#
# 用法:
#   ./docker/build.sh                 # 使用默认 tag: xxnuo/mtranserver:latest
#   ./docker/build.sh myrepo/mt:1.0   # 自定义 tag
#
# 说明:
#   - Dockerfile 位于 docker/Dockerfile，构建上下文为仓库根目录（便于 COPY 整个源码）
#   - 构建时会执行 bun run build:node，原生依赖(sharp/onnxruntime)由 node_modules 自带，
#     无需在镜像内系统安装 ONNX Runtime
#
set -euo pipefail

# 回到仓库根目录作为构建上下文
cd "$(dirname "$0")/.."

TAG="${1:-xxnuo/mtranserver:latest}"

echo "==> Building MTranServer image: ${TAG}"
docker build -f docker/Dockerfile -t "${TAG}" .

echo "==> Build complete."
echo "    启动: docker compose -f docker/compose.yml up -d"
echo "    或:   docker run -d -p 8989:8989 -v \"\$(pwd)/docker/models:/app/models\" ${TAG}"
