# 长期记忆 / 项目铁则（MEMORY.md）

## 铁则 1：版本号自动升级（MTranServer-1 本 Fork）
- 本仓库自 commit `1336ab64` 起进入独立的 **v5.x 版本线**，`1336ab64` = **v5.0.0**。
- 说明：`1336ab64` 本身是从 [@lan134342/MTranServer-1](https://github.com/lan134342/MTranServer-1) 引入的（含 OCR 图片翻译、模型管理器、Linux 部署文档等核心功能）。本 Fork 作者（用户）只写了 `1336ab64` **之后**的 commit（Docker 部署优化、镜像体积、离线迁移、文档等）。OCR 功能功劳归属 lan134342 仓库。
- 每次完成**实质性改动并提交**时，自动将 `package.json` 的 `version` 提升一个 patch：`5.0.x` → `5.0.(x+1)`。
- 同时必须在 `HISTORY.md` 顶部的「本 Fork 版本线（v5.x）」章节**新增对应版本条目**（按主题归并，参考 v5.0.1~5.0.10 的写法）。
- **不打 git tag**（除非用户明确要求）。
- v4.x 系列为上游历史，保留不动；新版本一律从 v5.0.x 递增。

## 铁则 2：禁止 PowerShell（及其他 shell）读写文件
- 修改任何文件（含 .bat/.ps1/.md/源码）一律只用 `replace_in_file` / `write_to_file` 工具。
- 绝对禁止用 PowerShell / cmd / sed 读写或替换文件内容（曾因错误编码导致中文乱码、把反斜杠误写入，改废用户脚本）。
- 唯一允许的 shell 用途是 git 版本控制命令（`git checkout/status/log` 等），且路径切换用 `Push-Location`/`Set-Location`。

## 铁则 3：git push 需用户确认
- 不要随意 `git push`。只有用户明确说「push」「推送」「提交到远程」等指令时才执行。
- 平时可以 `git add` 和 `git commit`，但 push 必须等用户确认。

## 关键项目约定（Docker 部署）
- OCR 字典（`ppocrv6_tiny_dict.txt`）走包内置源下载到 `$HOME/.cache/ppu-paddle-ocr`，**不受 `MT_MODEL_MIRROR_URL` 控制**。
- compose 挂载 `./docker/models/ocr-cache:/home/node/.cache/ppu-paddle-ocr` 做持久化。
- 绑定挂载卷首次建目录属主为 root，容器内 node(UID 1000) 无写权限 → 部署前需 `chown -R 1000:1000 docker/models/ocr-cache`。
- 离线迁移三件套：镜像 + `models/` + `docker-compose.yaml`，目标机须 x86_64 + glibc 同架构。
- 镜像体积优化用 `bun prune --production`（非 `bun install --production`，后者不删已装 dev 依赖）。
