# MTranServer Docker 部署

本目录包含 MTranServer 的 Docker 化部署所需全部文件。**源码构建（`--node` 模式）**，原生依赖（sharp / onnxruntime）由 `node_modules` 自带，无需在镜像内系统安装 ONNX Runtime。

> 另一份更通用的"Kylin 物理机源码部署"文档见仓库根 `docs/deploy-kylin.md`。本文件聚焦 Docker 部署。

---

## 一、目录结构

```
docker/
├── Dockerfile              # 多阶段构建：bun 构建 -> node:22-slim 运行
├── build.sh                # 镜像构建脚本（默认 tag: harbor.gbim.vip/freedo/mtranserver:latest）
├── docker-compose.yaml     # 部署编排（含模型/配置持久化卷）
├── models/                 # 模型持久化挂载点（.gitkeep 占位，运行时自动下载）
├── config/                 # 配置数据持久化挂载点（.gitkeep 占位，records.json 等）
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

`build.sh` 默认以 `--progress=plain` 构建，完整输出每个 RUN 层（含 `bun install`）的 stdout/stderr。`bun install` 默认**静默安装**（bun 在非 TTY 下无过程输出，只打印一行 `N packages installed`），避免日志刷屏；日志中 `RUN bun install ...` 层显示 `CACHED` 即说明命中了依赖层缓存（未重新安装）。

排查依赖下载 / 网络问题（如"空白卡住"疑似无响应）时，可开启 bun 的逐包安装日志，实时查看每个包的下载 / 解压详情：

```bash
DOCKER_BUILD_VERBOSE=1 ./docker/build.sh
```

> 注意：开启/关闭该开关会改变 Dockerfile `ARG` 值，使依赖安装层缓存失效并触发一次重装，属预期行为（bun 自带全局 tarball 缓存，重装较快）。

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
- 配置目录 `./docker/config` 会挂载到容器 `/app/config`，持久化 `records.json` 等配置数据，容器重建后不重复联网下载。
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
| `MT_CONFIG_DIR` | 配置数据目录（records.json 模型索引清单等） | `/app/config` |
| `MT_LOG_LEVEL` | 日志级别 | `info` |
| `MT_OFFLINE` | 是否离线模式（`true` 时完全不联网，需预置 `records.json` 与模型，见"十一、离线迁移"） | `false` |
| `MT_ENABLE_UI` | 是否启用 Web UI | `true` |
| `MT_MODEL_DOWNLOAD_SOURCE` | 模型下载源：`mirror`=走镜像站（默认，需配合 `MT_MODEL_MIRROR_URL`）；`official`=走 Firefox 官方源（含中文语言对与 `base` 档，见「十二、模型档位与下载源选择」） | `mirror` |
| `MT_MODEL_MIRROR_URL` | 模型镜像地址（仅 `MT_MODEL_DOWNLOAD_SOURCE=mirror` 时生效） | `http://183.136.206.212:8787` |
| `MT_DOWNLOAD_PROXY` | 模型/清单下载代理（http/https/socks/socks5 等，也支持把 `s5:` 自动纠正为 `socks5:`）；内网机出网下载模型时设置，如 `socks5://192.168.30.42:11111` | 未设置（直连） |
| `MT_API_TOKEN` | API 鉴权 token（设置后需 Bearer 鉴权） | 未设置 |
| `MT_LOG_DIR` | 日志文件目录（配合 `MT_LOG_TO_FILE=true` 生效） | `$HOME/logs` |
| `MT_LOG_TO_FILE` | 是否将日志写入文件（输出到 `MT_LOG_DIR`） | `false` |
| `MT_LOG_CONSOLE` | 是否将日志输出到控制台 | `true` |
| `MT_LOG_REQUESTS` | 是否在日志中记录每次请求的明细 | `false` |
| `MT_CHECK_UPDATE` | 启动时是否检查版本更新 | `true` |
| `MT_CACHE_SIZE` | 翻译结果缓存条目数（相同输入命中缓存直接返回，提升重复翻译性能） | `1000` |
| `MT_WORKER_IDLE_TIMEOUT` | 翻译 worker 空闲多久后自动退出（秒），释放内存；有请求时重新拉起 | `60` |
| `MT_WORKERS_PER_LANGUAGE` | 每个语言对并发 worker 数（提高并发吞吐，但更占内存） | `1` |
| `MT_MAX_SENTENCE_LENGTH` | 单句最大长度（字符数），超过会被截断 | `512` |
| `MT_FULLWIDTH_ZH_PUNCTUATION` | 是否将中文标点转为全角（符合中文排版习惯） | `true` |
| `MT_AUTO_UPDATE_ENABLED` | 是否启用模型自动更新调度器（后台按配置定时刷新清单并下载前 10 常用语言模型） | `true` |
| `MT_AUTO_UPDATE_HOUR` | 自动更新基准整点小时（0–23），作为每天首个执行点（固定该整点第 12 分钟） | `3` |
| `MT_AUTO_UPDATE_TIMES_PER_DAY` | 每天自动更新检查次数（1–24，相邻间隔不小于 1 小时，全天均匀分摊） | `1` |
| `MT_AUTO_UPDATE_LANGUAGES` | 自动更新覆盖的语言代码（逗号分隔），覆盖内置前 10 默认（zh,en,ja,ko,ru,fr,de,es,pt,ar） | 内置默认 |

> **模型自动更新说明**：调度器在端口监听成功后才启动（**不影响启动速度**），默认开启。它周期性刷新 Mozilla 模型清单并自动下载前 10 常用语言模型；已安装模型经哈希校验自动跳过，几乎零带宽开销。单次更新受 30 分钟超时保护，超时即中止本轮、正常排期下次，**绝不卡死主进程**。与离线模式互斥：`MT_OFFLINE=true` 时自动更新静默跳过。关闭/调参通过上方 4 个 `MT_AUTO_UPDATE_*` 变量控制，无需改动前端。日志关键字前缀 `[auto-update]`。详见仓库 `docs/model-auto-update.md`。

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
| `./docker/models/ocr-cache` | `/home/node/.cache/ppu-paddle-ocr` | OCR 预设模型/字典缓存持久化。`ppu-paddle-ocr` 的 `V6_SMALL_MODEL` 预设（det/rec 模型 `.ort` + 全量字典 `ppocrv6_dict.txt`）走包内置源下载（**不受 `MT_MODEL_MIRROR_URL` 控制**），新容器若不挂载会重新下载；**缓存命中不联网**，离线部署只需把 `PP-OCRv6_small_det.ort`、`PP-OCRv6_small_rec.ort`、`ppocrv6_dict.txt` 预置到此目录即可。在线跑过 OCR 后该目录已自包含，可随 `models/` 一起打包迁移 |
| `./docker/config` | `/app/config` | 配置数据持久化（`records.json` 模型索引清单等）。在线模式避免每次启动联网下载；离线模式（`MT_OFFLINE=true`）必须在此预置 `records.json` |

> 若需持久化其他数据（配置、日志等），可参照程序数据目录另行挂载。**不要删除 `./docker/models` 挂载**，否则每次重建容器都会重新下载模型。`./docker/config` 挂载目录若由 compose 自动创建，属主为宿主机 root，在线模式（需写入 records.json）需 `chown -R 1000:1000 docker/config`。

---

## 八、验证

```bash
# 健康检查（实际路由为 GET /health，无 /api 前缀）
curl http://localhost:8989/health

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
| 启动每次联网下载 records.json | 正常现象：清单仅几 KB，在线模式每次拉最新版以获取最新模型哈希。若不想联网，见"离线模式"章节 |
| `MT_OFFLINE=true` 启动失败（找不到 records.json） | 离线模式**不会**联网下载清单，需先在 `./docker/config/records.json` 预置；确认 `MT_CONFIG_DIR` 与 compose 挂载一致 |
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

镜像、模型、配置、编排四件套齐全后，可**整体迁移到任意支持 Docker 且 CPU 架构一致（x86_64 / glibc）的服务器**，目标机无需联网、无需访问任何模型下载源。

### 迁移包含的内容

```
mtranserver/                         # 任意目录名均可
├── docker-compose.yaml              # 编排（来自本目录）
├── config/                          # 配置数据（records.json 模型索引清单等）
│   └── records.json                 # 模型索引清单（首次在线启动后落盘于此，或手动拉取）
└── models/                          # 模型持久化目录（含 OCR 模型与字典，已自包含）
    ├── be_en/ de_en/ en_zh-Hans/ …  # 各语言对翻译模型（bergamot .bin/.spm）
    ├── ocr/                          # 本地 OCR onnx 模型（可选，有则优先；findLocalModel() 加载）
    │   └── pp-ocrv6-tiny/            # 如 PP-OCRv6/det/PP-OCRv6_det_tiny.onnx、PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx 等
    └── ocr-cache/                    # V6_SMALL_MODEL 预设缓存（= 容器内 ~/.cache/ppu-paddle-ocr）
        ├── PP-OCRv6_small_det.ort    # 预设检测模型（首次使用后落盘，随 models/ 打包）
        ├── PP-OCRv6_small_rec.ort    # 预设识别模型
        └── ppocrv6_dict.txt          # 全量识别字典（50+ 语言）
```

> 实际目录示例（Kylin V11 部署）：`models/` 下含 14 个翻译语言对目录 + `ocr/`（onnx）+ `ocr-cache/`（字典），共约 50 个文件，完整自包含。

> **`records.json` 是什么**：Firefox Translations 的模型索引清单（几 KB），罗列所有语言对模型的版本与 SHA-256 哈希，程序用它选模型、下载后校验。它不是模型数据，模型文件的大头在 `models/`。在线模式每次启动会联网拉最新清单（很小、几乎瞬间）；离线模式（`MT_OFFLINE=true`）则直接读 `config/records.json`，**不会联网**。

### 导出（源机）

```bash
# 1) 保存镜像（目标机无法访问 harbor 时）
docker save harbor.gbim.vip/freedo/mtranserver:latest -o mtranserver-image.tar

# 2) 打包编排、配置与模型目录（模型目录可能较大，按实际体积选择传输方式）
#    源机 config/ 内应有 records.json：容器在线跑过一次即有（宿主机 docker/config/records.json）；
#    若尚无，可先手动拉取一份，见下文「获取 records.json」。
cp docker/docker-compose.yaml ./mtranserver-bundle/
cp -r docker/config ./mtranserver-bundle/config
cp -r docker/models ./mtranserver-bundle/models
tar czf mtranserver-bundle.tar.gz mtranserver-bundle/
```

最终迁移介质：`mtranserver-image.tar` + `mtranserver-bundle.tar.gz`（内含 `docker-compose.yaml`、`config/` 与 `models/`）。

### 获取 records.json（可选，若源机 config/ 为空）

```bash
# 方式一：联网机器上先在线跑一次容器，落盘后拷出
docker compose -f docker/docker-compose.yaml up -d   # 等日志出现 "Downloading latest records.json"
cp docker/config/records.json ./mtranserver-bundle/config/records.json

# 方式二：直接从模型镜像站拉取（与 compose 中 MT_MODEL_MIRROR_URL 同源）
curl -fsSL -o ./mtranserver-bundle/config/records.json \
  "${MT_MODEL_MIRROR_URL:-http://183.136.206.212:8787}/records.json"
```

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
#    config/ 同理：离线模式只读 records.json，但目录需 node 可读；若后续切回在线模式需可写。
mkdir -p models/ocr-cache config
chown -R 1000:1000 models config

# 4) 如需完全离线（永不联网），设置环境变量后启动：
#    编辑 docker-compose.yaml：MT_OFFLINE=true，再执行下行；或
#    MT_OFFLINE=true docker compose -f docker-compose.yaml up -d
docker compose -f docker-compose.yaml up -d
```

### 切换到离线模式（MT_OFFLINE=true）

`MT_OFFLINE=true` 时程序**完全禁止联网**：启动读本地 `config/records.json`（缺失则报错退出），翻译时直接加载本地模型文件（缺失则加载失败，**不会去远程拉取**），`--download`/`--languages`/刷新清单等联网命令被禁用。

因此启用前提是**四件套已齐全**：

1. `config/records.json` 已预置（见上文「获取 records.json」）
2. `models/` 已包含需要用到的所有语言对模型 + `ocr/` + `ocr-cache/`
3. 确认无误后设 `MT_OFFLINE=true`（compose 的 `environment` 或启动命令前加环境变量）

> **OCR 图片翻译的离线预置**：OCR 候选顺序**线上线下一致**——本地模型（`models/ocr/` 下的 `pp-ocrv6-*` onnx）优先，`V6_SMALL_MODEL` 预设兜底。预设的模型/字典经 `~/.cache/ppu-paddle-ocr`（即 `models/ocr-cache/`）加载，**缓存命中直接读取、不联网**。离线模式（`MT_OFFLINE=true`）下**绝不触发联网下载**：本地模型缺失且预设缓存不齐全时，OCR 初始化直接报错并给出预置指引（不会尝试联网后失败）。因此离线部署只需满足其一：① 把预设三件套（`PP-OCRv6_small_det.ort`、`PP-OCRv6_small_rec.ort`、`ppocrv6_dict.txt`）预置到 `models/ocr-cache/`；② 在 `models/ocr/` 预置本地模型。二者满足其一即可（本地模型优先）。

> 在线模式（`MT_OFFLINE=false`，默认）下已有模型哈希校验：本地模型文件存在且 SHA-256 匹配就跳过下载、直接复用——不会重复下载模型；只有缺失或哈希不符才联网拉取。所以日常**并不需要**开离线模式，它主要服务于"部署到彻底断网的内网机"。

### 前提与限制

- **CPU 架构一致**：镜像内 sharp / onnxruntime 为 `x86_64` 原生二进制，目标机须为同架构（arm64 需另构建）。
- **glibc 运行环境**：镜像基于 `node:22-slim`（glibc），不能用 musl/alpine 系宿主机内核不兼容场景（一般 x86_64 Linux 均满足）。
- **OCR 缓存已齐全**：`models/ocr-cache/`（预置 `V6_SMALL_MODEL` 预设三件套：`PP-OCRv6_small_det.ort`、`PP-OCRv6_small_rec.ort`、`ppocrv6_dict.txt`）必须随包带走，否则离线/无网时 OCR 初始化会因缓存缺失而尝试联网下载失败；`models/ocr/` 本地模型为可选项（有则优先）。
- **离线模式需 records.json**：`MT_OFFLINE=true` 时必须预置 `config/records.json`；在线模式则每次启动联网拉最新清单（很小）。
- 若目标机已有镜像仓库访问能力，可只传 `models/` + `config/` + `docker-compose.yaml`，镜像从仓库 `pull` 即可。

---

## 十二、模型档位与下载源选择（自行决定）

MTranServer 的翻译模型来自 Firefox Translations（bergamot 本地 NMT）。每个语言对通常有多个**架构档位**可选，且模型可从**不同下载源**获取。下面把所有可选项讲清楚，由你按需组合。

### 12.1 档位：base-memory / base / tiny

代码（`src/models/records.ts` 的 `getPreferredArchitecture()`）默认优先顺序为 `['base-memory', 'base', 'tiny']`，即**默认选 `base-memory`**。三档含义：

| 档位 | 质量（comet22，语义指标） | 体积 | 说明 |
|------|--------------------------|------|------|
| `base-memory` | 基准（与 base 几乎持平） | 较小 | **默认档**。为内存受限场景优化的低内存变体，浏览器/本地部署首选 |
| `base` | 与 base-memory 基本持平（flores 实测中位差 ≈ 0） | 比 base-memory 大 ~36% | 全量权重，质量未明显优于 base-memory，但更占内存/磁盘 |
| `tiny` | 明显偏低 | 最小 | 最快最小，仅低资源环境才考虑 |

> **实测结论（基于官方 `models.json` 的 flores200-plus 指标）**：`base` 与 `base-memory` 的 **comet22 语义质量几乎一致（中位差 ≈ 0.0001，可忽略）**，`base` 仅在 spbleu 上小幅领先，但体积大 36%。因此**不建议为追求质量盲目切到 `base`**——收益极小、代价不小。默认的 `base-memory` 已是官方 release 首选档。
>
> 只有在特定语言对确实需要 `base`（如该对没有 base-memory 档）时，才需要显式指定 `architecture: 'base'`。

**如何选档**：在 Web UI 的模型管理器里下载某语言对时，可手动选择架构档位；也可通过下载 API 显式指定：
```bash
curl -X POST http://localhost:8989/api/models/download \
  -H "Content-Type: application/json" \
  -d '{"from":"zh","to":"en","architecture":"base"}'   # 不指定则走默认 base-memory
```

**立即触发一次自动更新**（手动触发后台刷新清单 + 下载前 10 语言模型，与定时任务逻辑相同；返回 `202` 即受理，进度看日志 `[auto-update]`）：
```bash
curl -X POST http://localhost:8989/models/auto-update \
  -H "Authorization: Bearer <MT_API_TOKEN>"   # 若启用 MT_API_TOKEN 鉴权
```
> 若已在更新中 / 已禁用 / 服务关闭中，返回 `200` 并带 `triggered:false` 与对应 `reason`，均不影响现有定时调度。

### 12.2 下载源：mirror（默认） vs official

| 源 | 环境变量 | 覆盖范围 | 适用 |
|----|----------|----------|------|
| 镜像站（默认） | `MT_MODEL_DOWNLOAD_SOURCE=mirror` + `MT_MODEL_MIRROR_URL=http://183.136.206.212:8787` | 我们内部镜像站，**不含中文（zh）语言对**，多数为 `base-memory` 档 | 内网、翻非中文小语种 |
| 官方源 | `MT_MODEL_DOWNLOAD_SOURCE=official` | Firefox 官方源（Mozilla CDN），**含中文语言对（zh-en / en-zh）及 base 档** | 需要中文翻译、且服务器能联网到官方源时 |

> **重要**：你当前默认配置走 `mirror` 源，而该镜像站**没有 zh 语言对**。如果你在做**中↔英翻译却效果"凑合"甚至翻不动**，根因很可能是**没用上正确的中文模型**——应切到 `official` 源下载中文对。

**切换到官方源**（compose `environment` 中改/加）：
```yaml
environment:
  - MT_MODEL_DOWNLOAD_SOURCE=official
  # MT_MODEL_MIRROR_URL 在 official 源下不生效，可保留或删除
```

### 12.3 下载代理 MT_DOWNLOAD_PROXY

无论 mirror 还是 official，模型/清单下载都支持走代理（代码见 `src/core/factory.ts`：proxy 非空即用 `proxy-agent` 走代理）：

```yaml
environment:
  - MT_DOWNLOAD_PROXY=socks5://192.168.30.42:11111   # 支持 http/https/socks/socks5；s5: 会自动纠正为 socks5:
```

- 代理仅作用于**模型/清单下载**，不影响服务正常流量。
- 若服务器本身能直连目标源，可不设此变量（直连）。

### 12.4 推荐组合（按场景）

| 场景 | 配置 |
|------|------|
| 内网、翻非中文、源可达 | `mirror` + 默认 `base-memory`（不改） |
| **需要中文翻译** | `official` 源（含 zh-en/en-zh），按需 `architecture: base` 或保持默认 |
| 服务器需经代理才能联网下载 | 上述任一源 + `MT_DOWNLOAD_PROXY=...` |
| 彻底断网 | 见「十一、离线迁移」四件套预置，离线模式不走任何下载源 |

> 注意：切换下载源后，旧源已下载的模型仍保留在 `./docker/models`，不影响；新语言对会按新源下载。中文模型首次下载体积较大（zh 单个语言对解压后约 60–90MB），首次翻译会变慢，属正常。

