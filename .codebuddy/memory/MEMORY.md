# 长期记忆 / 项目铁则（MEMORY.md）

## 铁则 1：版本号自动升级（MTranServer-1 本 Fork）
- 本仓库自 commit `1336ab64` 起进入独立的 **v5.x 版本线**，`1336ab64` = **v5.0.0**。
- 说明：`1336ab64` 本身是从 [@lan134342/MTranServer-1](https://github.com/lan134342/MTranServer-1) 引入的（含 OCR 图片翻译、模型管理器、Linux 部署文档等核心功能）。本 Fork 作者（用户）只写了 `1336ab64` **之后**的 commit（Docker 部署优化、镜像体积、离线迁移、文档等）。OCR 功能功劳归属 lan134342 仓库。
- 每次完成**实质性改动并提交**时升级版本号。**目标版本号以用户当时指令为准**（用户会直接指定，如 `5.1.0` 表示 minor；若未指定则默认升一个 patch：`5.0.x` → `5.0.(x+1)`）。
- **升级版本号必须使用 `bun run bump <version>`（`scripts/bump.ts`）统一执行**，切勿手动只改 `package.json`。`bump.ts` 已包含 `updateTsFile("src/version/index.ts")`，会自动同步源码 `VERSION` 常量——之前 `4.0.33` 漏跟 `5.0.20` 就是没走脚本所致。漏改 `src/version/index.ts` 会导致运行时版本展示与实际发版不一致。bump 接受具体版本参数（如 `bun run bump 5.1.0`），会同步根 `package.json`、`ui/package.json`、`tsoa.json`、`src/version/index.ts` 四文件。
- 同时必须在 `HISTORY.md` 顶部的「本 Fork 版本线（v5.x）」章节**新增对应版本条目**（按主题归并，参考 v5.0.1~v5.0.27 的写法；minor 升级如 5.1.0 放在 v5.0.x 之上的最新位置）。
- **不打 git tag**（除非用户明确要求）。
- v4.x 系列为上游历史，保留不动；新版本一律从 v5.0.x 递增（minor 升级如 5.1.0 同理递增）。
- **提交纪律**：先 `git add`+`commit` 功能改动，再单独 `bump`+`commit` 版本号（两阶段分离，便于 review）；`bump` 与 `push` 均需用户明确指令，绝不自动执行。

## 铁则 2：禁止 PowerShell（及其他 shell）读写文件
- 修改任何文件（含 .bat/.ps1/.md/源码）一律只用 `replace_in_file` / `write_to_file` 工具。
- 绝对禁止用 PowerShell / cmd / sed 读写或替换文件内容（曾因错误编码导致中文乱码、把反斜杠误写入，改废用户脚本）。
- 唯一允许的 shell 用途是 git 版本控制命令（`git checkout/status/log` 等），且路径切换用 `Push-Location`/`Set-Location`。

## 代理约定（2026-08-24）
- 联网抓取（web_fetch/直连）失败时，自动使用代理 `socks5://192.168.30.42:11111`（用户原话写的是 `socket5://`，实际使用为 `socks5://`）。
- 适用场景：查证官方文档、下载模型/字典、GitHub/HuggingFace 等直连被拒时。
- 用法示例：`curl.exe -sL --proxy socks5://192.168.30.42:11111 "https://..."`。

## 铁则 4：`.codebuddy/` 目录必须强制入库
- `.codebuddy/`（含 `memory/`、`plans/` 等全部子目录与文件）是**项目资产，必须随代码一起 git 提交**，不得按"本地工作记忆"为由排除。
- 用户明确要求：无论 AI 工作记忆、计划草稿（plans/）、还是版本草稿，均视为应入库内容。
- 执行 `git add` 时应包含 `.codebuddy/`（如 `git add .codebuddy/` 或 `git add -A` 后确认其被纳入）；用户说 "commit all" 时必须把 `.codebuddy/` 一并提交。
- 注意：`.codebuddy/` 中的文件多为 AI 生成/维护，但属用户意志要求入库，无需过滤。

## 铁则 3：git push 需用户确认
- 不要随意 `git push`。只有用户明确说「push」「推送」「提交到远程」等指令时才执行。
- 平时可以 `git add` 和 `git commit`，但 push 必须等用户确认。

## 关键项目约定（Docker 部署）
- OCR 预设（`V6_SMALL_MODEL`）的模型（.ort）+ 全量字典 `ppocrv6_dict.txt` 走包内置源下载到 `$HOME/.cache/ppu-paddle-ocr`，**不受 `MT_MODEL_MIRROR_URL` 控制**；**缓存命中直接读、不联网**，离线只需预置三件套（`PP-OCRv6_small_det.ort`、`PP-OCRv6_small_rec.ort`、`ppocrv6_dict.txt`）。OCR 候选顺序线上线下一致：本地 `models/ocr/` onnx 优先，预设兜底。
- compose 挂载 `./docker/models/ocr-cache:/home/node/.cache/ppu-paddle-ocr` 做持久化。
- 绑定挂载卷首次建目录属主为 root，容器内 node(UID 1000) 无写权限 → 部署前需 `chown -R 1000:1000 docker/models/ocr-cache`。
- 离线迁移三件套：镜像 + `models/` + `docker-compose.yaml`，目标机须 x86_64 + glibc 同架构。
- 镜像体积优化用 `bun prune --production`（非 `bun install --production`，后者不删已装 dev 依赖）。
- `docker/package.json` 的 version 固定 `1.0.0`，**不随根版本号 bump**（bun.lock 的 root 条目不记录 version，固定不影响 `--frozen-lockfile`；反之每次 bump 该文件会导致 Docker COPY 层缓存失效、`RUN bun install` 每次重跑）。.gitattributes 已将 docker/** 与 *.sh 固定 LF 防 CRLF 波动。

## 经验教训：offline 模式设计原则（2026-08-24，v5.0.26）
- **离线模式（任何 enableOfflineMode 开关）绝不改变候选/调用顺序**——保持线上线下同一顺序，只在 offline 下加"禁止联网"的前置校验（fail-fast 报错指引）。
- 改第三方包行为前必须先读其源码确认机制（尤其下载/缓存逻辑），不能凭猜；本次 `ppu-paddle-ocr` 缓存命中不联网、文件名 = `path.basename(url)` 全靠读 `model-cache.ts` 确认。
- 文档是行为契约，代码行为变化后必须同步核对所有相关文档段落。
- 完整教训与场景矩阵见 `docs/lessons/offline-ocr.md`（新增的 lessons 目录，与 plans/ 并列）。

## 经验教训：后台定时任务 / 自动更新设计模式（2026-08-25，v5.1.0 模型自动更新）
- **启动路径隔离**：后台调度器必须挂在 `app.listen` 回调（端口监听成功后）或等价"启动完成"点，**绝不**放进 `initRecords()`/`resumePendingDownloads()` 等启动关键路径，避免拖慢或阻塞启动。
- **递归 `setTimeout` 而非 `setInterval`**：每次执行后重新计算"下次执行时刻"再排期，避免任务耗时导致的间隔漂移，且可随时 `clearTimeout` 清理（服务关闭时必需）。
- **超时保护防卡死主进程**：单次任务整体用 `AbortController` + 硬超时（本例 30 分钟）包裹；超时即中止本轮、正常排期下次。用户明确要求"不能一直卡死影响主进程"——任何联网/下载型后台任务都应有此保护。
- **失败隔离**：单条子任务（如某个语言对的下载）失败仅记日志、不中断其他子任务与其他周期；整体再用一层 try/catch 兜底。
- **互斥前置校验**：与 offline 等模式互斥时，在任务入口首行做 fail-fast 跳过（本例检查 `enableOfflineMode`），并复用底层 API 自身已有的拒绝逻辑作双重保险。
- **选型落地确认**：Mozilla 模型库无真实下载量数据，"排名前10语言"用**预置常用语言列表**（zh,en,ja,ko,ru,fr,de,es,pt,ar）实现，内置常量 + 环境变量可覆盖；英语枢纽架构下实际触发的是各语言与 `en` 的双向配对。
- **文档同步范围**：新增配置类功能时，所有文档中的 `MT_*` 环境变量表都要同步——至少覆盖根 README、Kylin 部署文档、Docker 文档（README + compose 注释）三处，保持完全一致；纯环境变量控制的功能前端可不暴露开关。
