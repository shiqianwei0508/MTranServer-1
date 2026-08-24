# MTranServer Docker 部署

本目录包含 MTranServer 的 Docker 化部署所需全部文件。**源码构建（`--node` 模式）**，原生依赖（sharp / onnxruntime）由 `node_modules` 自带，无需在镜像内系统安装 ONNX Runtime。

> 另一份更通用的"Kylin 物理机源码部署"文档见仓库根 `docs/deploy-kylin.md`。本文件聚焦 Docker 部署。

---

## 一、目录结构

```
docker/
├── Dockerfile              # 多阶段构建：bun 构建 -> node:22-slim 运行
├── build.sh                # 镜像构建脚本（默认 tag: harbor.gbim.vip/freedo/mtranserver:latest）
├── docker-compose.yaml     # 部署编排（含模型持久化卷）
├── models/                 # 模型持久化挂载点（.gitkeep 占位，运行时自动下载）
└── README.md               # 本文件
```

---

## 二、前置要求

- Docker ≥ 20.10 且包含 Compose v2（`docker compose` 子命令可用）
- 可访问镜像仓库 `harbor.gbim.vip`（拉取或推送）
- 服务器可访问模型下载源（默认公网；内网可设 `MT_MODEL_MIRROR_URL` 走镜像）
- 国内环境：`Dockerfile` 已内置 npm（npmmirror）与 apt（阿里云）国内源；拉取 `oven/bun`、`node` 基础镜像如需加速，请在 docker daemon 配置 registry mirror（如 `https://registry.npmmirror.com` 或阿里云容器镜像服务）

---

## 三、构建镜像

在**仓库根目录**执行（构建上下文必须是仓库根，Dockerfile 通过 `-f docker/Dockerfile` 指定）：

```bash
# 方式一：使用脚本（推荐）
./docker/build.sh

# 方式二：手动命令
docker build -f docker/Dockerfile -t harbor.gbim.vip/freedo/mtranserver:latest .
```

自定义 tag：

```bash
./docker/build.sh harbor.gbim.vip/freedo/mtranserver:v1.0
```

### 推送到 Harbor

```bash
docker login harbor.gbim.vip
docker push harbor.gbim.vip/freedo/mtranserver:latest
```

---

## 四、部署（docker compose）

在**仓库根目录**执行：

```bash
docker compose -f docker/docker-compose.yaml up -d
```

- 模型目录 `./docker/models` 会挂载到容器 `/app/models`，**持久化在宿主机**，容器重建后模型不丢失。
- 服务默认模型目录即为 `/app/models`，无需额外设置。
- 访问地址：`http://服务器IP:8989/ui/`、`http://服务器IP:8989/docs/`。

停止 / 查看日志：

```bash
docker compose -f docker/docker-compose.yaml down
docker compose -f docker/docker-compose.yaml logs -f
```

---

## 五、配置说明

`docker-compose.yaml` 中的环境变量与 Kylin 物理机部署的 systemd service 文件保持**一致**（均采用 `MT_` 前缀），配置与启动命令解耦，敏感 token 不出现在进程列表。

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MT_HOST` | 监听地址 | `0.0.0.0` |
| `MT_PORT` | 监听端口 | `8989` |
| `MT_MODEL_DIR` | 模型目录 | `/app/models` |
| `MT_LOG_LEVEL` | 日志级别 | `info` |
| `MT_OFFLINE` | 是否离线模式 | `false` |
| `MT_ENABLE_UI` | 是否启用 Web UI | `true` |
| `MT_MODEL_DOWNLOAD_SOURCE` | 模型下载源 | `mirror` |
| `MT_MODEL_MIRROR_URL` | 模型镜像地址 | `http://183.136.206.212:8787` |
| `MT_API_TOKEN` | API 鉴权 token（设置后需 Bearer 鉴权） | 未设置 |

> 优先级：命令行参数 > 环境变量 > 配置文件 > 默认值。

如启用 API 鉴权，在 `docker-compose.yaml` 的 `environment` 中取消注释并填写：
```yaml
- MT_API_TOKEN=your_secret_token_here
```

---

## 六、用户与权限

- 运行镜像基于 `node:22-slim`（**glibc**，匹配 sharp / onnxruntime 原生二进制；不能用 alpine/musl）。
- 容器内以**非 root 用户 `node`** 运行（node:22-slim 自带，UID/GID = 1000），对应 Kylin 物理机部署中 systemd 的 `User=freedo`（均为非 root 运行，便于宿主机挂载卷权限匹配）。
- `/app/models` 在镜像内已 `chown node:node`，运行时可正常写入模型。

---

## 七、持久化说明（强烈建议保留）

| 挂载 | 容器内路径 | 作用 |
|------|-----------|------|
| `./docker/models` | `/app/models` | 翻译模型持久化，避免容器重建后重新下载 |

> 若需持久化其他数据（配置、日志等），可参照程序数据目录另行挂载。**不要删除 `./docker/models` 挂载**，否则每次重建容器都会重新下载模型。

---

## 八、验证

```bash
# 健康检查
curl http://localhost:8989/api/health

# 模型列表
curl http://localhost:8989/api/models

# 翻译测试
curl http://localhost:8989/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, world!","source":"en","target":"zh-Hans"}'
```

> 若设置了 `MT_API_TOKEN`，请求需带 `Authorization: Bearer <token>`。

---

## 九、排错

| 症状 | 排查 |
|------|------|
| 容器启动后端口不通 | `docker ps` 确认状态；`docker logs mtranserver` 看启动日志；`ss -tlnp \| grep 8989` 查宿主机端口 |
| 模型重复下载 | 确认 `./docker/models` 挂载存在且未被误删；`docker inspect mtranserver` 查 Mounts |
| 首次翻译慢 / 超时 | 首次会下载对应语言对模型，属正常；确认 `MT_MODEL_MIRROR_URL` 可达 |
| 镜像构建失败（native 模块） | 确保用 `node:22-slim`（glibc）而非 alpine；`--node` 模式会保留 `node_modules` 外部引用 |
| 挂载目录无写入权限 | 宿主机 `./docker/models` 属主应为 UID 1000（与容器内 node 用户对齐），否则 `chown -R 1000:1000 docker/models` |

---

## 十、与物理机部署的差异

| 项 | Docker 部署 | Kylin 物理机部署 |
|----|------------|----------------|
| 构建 | `docker build`（容器内 `--node`） | `bun run build --node` |
| 运行 | `node main.js`（容器内 freedo 用户） | `bun dist/main.js`（systemd freedo 用户） |
| 原生依赖 | `node_modules` 自带 | `node_modules` 自带 |
| 模型目录 | 挂载卷 `./docker/models` | `/data/mtranserver/models` |
| 配置 | compose `environment` | systemd `Environment` / `EnvironmentFile` |
