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

### 构建缓存说明

`docker/package.json` 的 `version` 字段**固定为 `1.0.0`**，不随仓库版本号 bump。原因：Docker 层缓存中 `COPY docker/package.json` 层的源文件哈希一旦变化，紧随其后的 `RUN bun install` 层缓存就会失效，导致每次构建都重新安装依赖。而 bun.lock 的 root 条目不记录 version，固定它不影响 `--frozen-lockfile` 解析。**请勿修改该 version 字段**；依赖变动只更新 `dependencies`/`devDependencies` 与 `bun.lock`。

### 可选构建代理

构建阶段默认不启用任何代理（依赖走 npmmirror、apt 走阿里云，国内直连即可）。如在内网/受限环境需走代理，可用 `DOCKER_BUILD_PROXY` 环境变量启用（需为 **http/https** 代理，`bun`/`apt` 不支持 socks5）：

```bash
DOCKER_BUILD_PROXY=http://127.0.0.1:7890 ./docker/build.sh
```

> 说明：基础镜像（`FROM` 的 `oven/bun`、`node:22-slim`）拉取发生在 docker daemon 层，**不受此代理控制**，请在 docker daemon 配置 registry mirror 或 daemon 级代理。

### 构建日志输出

`build.sh` 默认以 `--progress=plain` 构建，完整输出每个 RUN 层（含 `bun install`）的 stdout/stderr，方便排查安装过程；`Dockerfile` 中 `bun install` 已加 `--verbose`，会打印每个包的解析/安装详情。日志中 `RUN bun install ...` 层显示 `CACHED` 即说明命中了依赖层缓存（未重新安装）。

如需恢复 BuildKit 默认的树状进度格式，可设置环境变量：

```bash
DOCKER_BUILD_PROGRESS=auto ./docker/build.sh
```

> 兼容性：legacy builder（未安装 buildx / 未启用 BuildKit 的旧 Docker）不支持 `--progress` 参数，脚本会自动检测并降级跳过（其默认输出本就会完整打印 RUN 层日志，不影响查看 `bun install` 过程）。

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
| `./docker/models/ocr-cache` | `/home/node/.cache/ppu-paddle-ocr` | OCR 字典缓存持久化。`ppu-paddle-ocr` 的字典走包内置源下载（**不受 `MT_MODEL_MIRROR_URL` 控制**），新容器若不挂载会重新下载。字典落盘后即为 `ocr-cache/ppocrv6_tiny_dict.txt`，已包含在 `models/` 内，可随 `models/` 一起打包迁移 |

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
| 挂载目录无写入权限 | 宿主机 `./docker/models` 及其子目录属主应为 UID 1000（与容器内 node 用户对齐），否则 `chown -R 1000:1000 docker/models` |
| 绑定挂载卷变成 root 属主、容器内 node 用户写不进 | **典型症状**：`ls -l /app/models` 看到 `ocr-cache` 目录属主是 `root root`（其他模型目录是 `node node`），OCR 字典下载卡住/失败。原因：`docker compose up` 首次会自动在**宿主机**创建绑定挂载点目录，创建者为宿主机 root，因此该目录属主是 `root:root`、权限 755，容器内 node 用户（UID 1000）无写权限。翻译模型目录（`ocr`、`be_en` 等）因是容器内 node 进程创建的，属主正常为 `node`。**修复**：在宿主机手动 `chown -R 1000:1000 docker/models/ocr-cache`（UID 1000 = 容器内的 node 用户），重启容器即可。预防：先手动建好目录并改好属主再 `up`，Docker 就不会用 root 去建。注意 `Dockerfile` 里的 `chown -R node:node /app` 对挂载卷无效——卷内容在镜像层之外。 |

---

## 十、与物理机部署的差异

| 项 | Docker 部署 | Kylin 物理机部署 |
|----|------------|----------------|
| 构建 | `docker build`（容器内 `--node`） | `bun run build --node` |
| 运行 | `node main.js`（容器内 freedo 用户） | `bun dist/main.js`（systemd freedo 用户） |
| 原生依赖 | `node_modules` 自带 | `node_modules` 自带 |
| 模型目录 | 挂载卷 `./docker/models` | `/data/mtranserver/models` |
| 配置 | compose `environment` | systemd `Environment` / `EnvironmentFile` |

---

## 十一、离线迁移（完全离线部署）

镜像、模型、编排三件套齐全后，可**整体迁移到任意支持 Docker 且 CPU 架构一致（x86_64 / glibc）的服务器**，目标机无需联网、无需访问任何模型下载源。

### 迁移包含的内容

```
mtranserver/                         # 任意目录名均可
├── docker-compose.yaml              # 编排（来自本目录）
└── models/                          # 模型持久化目录（含 OCR 模型与字典，已自包含）
    ├── be_en/ de_en/ en_zh-Hans/ …  # 各语言对翻译模型（bergamot .bin/.spm）
    ├── ocr/
    │   └── pp-ocrv6-tiny/           # OCR onnx 模型（det/rec/cls），由 findLocalModel() 本地加载
    │       ├── PP-OCRv6/det/PP-OCRv6_det_tiny.onnx
    │       ├── PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx
    │       └── shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx
    └── ocr-cache/
        └── ppocrv6_tiny_dict.txt    # OCR 字典（首次下载后落盘，已随 models/ 打包）
```

> 实际目录示例（Kylin V11 部署）：`models/` 下含 14 个翻译语言对目录 + `ocr/`（onnx）+ `ocr-cache/`（字典），共约 50 个文件，完整自包含。

### 导出（源机）

```bash
# 1) 保存镜像（目标机无法访问 harbor 时）
docker save harbor.gbim.vip/freedo/mtranserver:latest -o mtranserver-image.tar

# 2) 打包编排与模型目录（模型目录可能较大，按实际体积选择传输方式）
cp docker/docker-compose.yaml ./mtranserver-bundle/
cp -r docker/models ./mtranserver-bundle/models
tar czf mtranserver-bundle.tar.gz mtranserver-bundle/
```

最终迁移介质：`mtranserver-image.tar` + `mtranserver-bundle.tar.gz`（内含 `docker-compose.yaml` 与 `models/`）。

### 导入与启动（目标机）

```bash
# 1) 载入镜像
docker load -i mtranserver-image.tar

# 2) 解包
tar xzf mtranserver-bundle.tar.gz
cd mtranserver-bundle

# 3) 修正挂载目录属主（关键！）
#    compose 首次 up 会自动建 ./models/ocr-cache 且属主为 root，容器内 node(UID 1000) 无写权限。
#    事先手动建好并改属主，避免 OCR 字典写入失败。
mkdir -p models/ocr-cache
chown -R 1000:1000 models

# 4) 启动
docker compose -f docker-compose.yaml up -d
```

### 前提与限制

- **CPU 架构一致**：镜像内 sharp / onnxruntime 为 `x86_64` 原生二进制，目标机须为同架构（arm64 需另构建）。
- **glibc 运行环境**：镜像基于 `node:22-slim`（glibc），不能用 musl/alpine 系宿主机内核不兼容场景（一般 x86_64 Linux 均满足）。
- **模型已齐全**：`models/ocr/pp-ocrv6-tiny` 与 `models/ocr-cache/*.txt` 必须随包带走，否则容器启动后仍会尝试联网下载。
- 若目标机已有镜像仓库访问能力，可只传 `models/` + `docker-compose.yaml`，镜像从仓库 `pull` 即可。

