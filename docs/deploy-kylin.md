# MTranServer 在 Kylin V11（银河麒麟）上的部署文档

> **文档定位**：本文档基于真实部署过程整理，覆盖从环境准备、源码构建、到 systemd 生产化部署的**顺序流程**。前两节即可完成一次干净部署；遇到问题时再跳到文末"问题排查"章节。所有踩坑记录均来自 Kylin V11 + x86_64 + Bun 1.4.0 环境的实测。
>
> - 项目仓库：https://github.com/shiqianwei0508/MTranServer-1.git
> - 官方 Linux 部署参考：docs/deploy-linux.md（仓库内）
> - 部署方式：**源码构建**（改过源码 / 自定义功能时的推荐方式）
> - 更新日期：2026-08-24

---

## 一、项目与环境说明

### 1.1 MTranServer 简介

MTranServer 是一款**低资源占用、可私有部署的离线翻译模型服务器**，基于 Bergamot / WASM 翻译引擎，内置 OCR 图片翻译功能，无需依赖外部翻译 API，适合内网 / 离线环境。

### 1.2 环境要求

| 项目 | 要求 / 本次实测值 |
|------|------------------|
| OS | Linux x86_64 / arm64（Ubuntu / Debian / CentOS / Kylin 均可） |
| 本机 OS | Kylin V11 Server（Linux x86_64, glibc） |
| Node.js | ≥ 18（源码构建 / `npm install` 拉取原生依赖时需要） |
| Bun | ≥ 1.2（源码构建与运行时启动均需要） |
| 内存 | ≥ 512MB（每个语言对约占用 200–400MB） |
| 磁盘 | ≥ 2GB（模型 + 程序） |
| 原生依赖 | `--node` 模式下 ONNX Runtime / sharp 均由 `node_modules` 自带，无需系统安装 |

### 1.3 路径约定

| 路径 | 说明 |
|------|------|
| `/data/source/MTranServer-1` | 源码根目录（git clone 位置） |
| `/data/mtranserver/models` | 翻译模型存放目录 |
| `/etc/systemd/system/mtranserver.service` | systemd 服务文件 |

---

## 二、环境准备

### 2.0 安装 Node（nvm 方式）

源码构建时需要 Node（`npm install` 拉取 `sharp` 等原生依赖），推荐用 nvm 管理版本。

```bash
# 安装 nvm（安装脚本会写入 ~/.bashrc，新开 shell 自动生效）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash

# 退出当前 shell 重新登录，或手动 source 使 nvm 生效
exit
# 重新登录后：
nvm list

# 安装并切换到 Node 22（≥ 18 即可）
nvm install 22
nvm list
node -v          # 确认版本，本次实测 v22.x

# 配置 npm 镜像源（加速依赖安装，避免访问官方源超时）
npm config set registry=http://registry.npmjs.org/
```

> 注：若服务器处于内网 / 离线环境无法访问 npm 官方源，将上面 `registry` 替换为可达的私有镜像地址。Node 仅在**构建阶段**使用，运行期服务由 Bun 启动（见第五节），因此无需把 Node 加入 systemd 的 `PATH`。

### 2.1 安装 Bun

```bash
curl -fsSL https://bun.sh/install | bash

# 将 bun 加入 PATH（写入 ~/.bashrc 后重新登录或 source）
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

bun --version   # 确认 ≥ 1.2，本次实测 Bun v1.4.0
```

> 如果用非 root 用户部署，确保该用户的 `~/.bun/bin` 在 PATH 中；systemd 服务里**务必写 bun 的绝对路径**（见第五节）。

---

## 三、源码构建

> 适用场景：改过源码或需要自定义功能。如仅运行不改源码，可参考官方文档的"npm 全局安装"或"单文件二进制"方式（但单文件方式在 Kylin + 原生模块场景下不兼容，建议优先源码构建）。

### 3.1 获取源码

```bash
git clone https://github.com/shiqianwei0508/MTranServer-1.git /data/source/MTranServer-1
cd /data/source/MTranServer-1
```

### 3.2 安装依赖

```bash
# 关键：显式安装 linux-x64 平台的 sharp 原生二进制
npm install --cpu=x64 --os=linux --libc=glibc sharp
npm install --include=optional sharp
npm install
```

### 3.3 构建（使用 --node 模式，不要用 --single）

```bash
# ✅ 正确：--node 模式，保留 node_modules 结构
bun run build --node

# ❌ 错误：--single 单文件模式与原生 .node 模块不兼容
# bun run build --single
```

构建成功后，`dist/` 目录生成 `main.js` / `desktop.js` 等入口，项目根目录的 `node_modules/` 保持完整。

> **注意（图片翻译字体）**：`bun build --node` 会把 `src/assets/fonts/*.woff2` 复制到 `dist/` 目录下（文件名带内容哈希，如 `noto-sans-sc-latin-400-normal-kf9x9bhb.woff2`），导入返回的是**相对于 `dist/main.js` 的相对路径**。运行时必须用 `import.meta.url` 把该路径解析为基于 `dist/` 目录的绝对路径后读取（见 `src/assets/fonts.ts` 中的 `resolveFontPath`）。若直接用相对路径 `readFile`，会以进程 CWD（项目根目录）为基准，导致 `ENOENT: no such file or directory, open './noto-sans-sc-latin-400-normal-*.woff2'`，表现为图片翻译功能报错。该修复已合入仓库，只需重新构建即可生效。

### 3.4 手动启动验证（调试用）

```bash
cd /data/source/MTranServer-1
bun dist/main.js
```

成功启动应看到：
```
[INFO] MTranServer v4.0.33 is running!
[INFO] Web UI: http://0.0.0.0:8989/ui/
[INFO] Swagger Docs: http://0.0.0.0:8989/docs/
```

> 注：`--node` 模式下 ONNX Runtime / sharp 由 `node_modules` 自带，无需系统安装或设置 `LD_LIBRARY_PATH`。

---

## 四、配置说明

MTranServer 支持命令行参数与 `MT_` 前缀环境变量，**优先级：命令行参数 > 环境变量 > 配置文件 > 默认值**。

### 4.1 常用 MT_ 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `MT_HOST` | 监听地址 | `0.0.0.0` |
| `MT_PORT` | 监听端口 | `8989` |
| `MT_API_TOKEN` | API 鉴权 token（设置后需 Bearer 鉴权） | `your_secret_token` |
| `MT_MODEL_DIR` | 模型存放目录 | `/data/mtranserver/models` |
| `MT_OFFLINE` | 是否离线模式 | `false` |
| `MT_LOG_LEVEL` | 日志级别 | `info` |
| `MT_MODEL_DOWNLOAD_SOURCE` | 模型下载源 | `mirror` |
| `MT_MODEL_MIRROR_URL` | 模型镜像地址 | `http://183.136.206.212:8787` |

### 4.2 模型目录准备

```bash
sudo mkdir -p /data/mtranserver/models
sudo chown -R freedo:freedo /data/mtranserver/models   # 改为实际部署用户
chmod 755 /data/mtranserver/models
```

---

## 五、systemd 生产化部署

### 5.1 创建 service 文件

推荐使用 `MT_` 环境变量方式配置（比命令行参数更干净、配置与启动命令解耦、敏感 token 不出现在进程列表）：

```bash
sudo tee /etc/systemd/system/mtranserver.service << 'EOF'
[Unit]
Description=MTranServer Translation Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=freedo
WorkingDirectory=/data/source/MTranServer-1

# ---- 全部配置走 MT_ 环境变量 ----
Environment=MT_HOST=0.0.0.0
Environment=MT_PORT=8989
Environment=MT_MODEL_DIR=/data/mtranserver/models
Environment=MT_LOG_LEVEL=info
Environment=MT_OFFLINE=false
Environment=MT_MODEL_DOWNLOAD_SOURCE=mirror
Environment=MT_MODEL_MIRROR_URL=http://183.136.206.212:8787
# 如需 API 鉴权，取消下行注释并填入实际 token：
# Environment=MT_API_TOKEN=your_secret_token

# ---- 启动命令（bun 使用绝对路径，which bun 确认） ----
ExecStart=/home/freedo/.bun/bin/bun dist/main.js

Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 5.2 启动与状态

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mtranserver

sudo systemctl status mtranserver
sudo journalctl -u mtranserver -f      # 实时日志
sudo journalctl -u mtranserver --no-pager -n 50  # 最近 50 行
```

### 5.3 可选：使用 EnvironmentFile 管理配置

配置项较多时，可集中到 `.env` 文件，service 文件用 `EnvironmentFile=` 引用，改配置无需 `daemon-reload`：

```ini
# /data/source/MTranServer-1/.env
MT_HOST=0.0.0.0
MT_PORT=8989
MT_MODEL_DIR=/data/mtranserver/models
MT_LOG_LEVEL=info
MT_OFFLINE=false
MT_MODEL_DOWNLOAD_SOURCE=mirror
MT_MODEL_MIRROR_URL=http://183.136.206.212:8787
```

service 文件中替换所有 `Environment=` 行为：
```ini
EnvironmentFile=/data/source/MTranServer-1/.env
```

---

## 六、验证与访问

### 6.1 浏览器访问

| 功能 | 地址 |
|------|------|
| Web UI | `http://服务器IP:8989/ui/` |
| API 文档 (Swagger) | `http://服务器IP:8989/docs/` |
| 健康检查 | `http://服务器IP:8989/api/health` |

### 6.2 API 快速测试

```bash
curl http://localhost:8989/api/models
curl http://localhost:8989/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, world!","source":"en","target":"zh-Hans"}'
```

> 若设置了 `MT_API_TOKEN`，请求需带 `Authorization: Bearer <token>`。

### 6.3 防火墙放行

```bash
# firewalld（Kylin 默认）
sudo firewall-cmd --add-port=8989/tcp --permanent
sudo firewall-cmd --reload

# 或 ufw
sudo ufw allow 8989/tcp
```

---

## 七、总结与决策表

| 决策点 | 正确选择 | 避免 |
|--------|----------|------|
| 打包模式 | `bun run build --node` | ~~`--single`~~（与原生 `.node` 模块不兼容） |
| 原生依赖 | 由 `node_modules` 自带（ONNX Runtime / sharp） | ~~系统安装 `libonnxruntime` + `ldconfig`~~（仅 `--single` 时代需要） |
| 配置方式 | `MT_` 环境变量 / `EnvironmentFile` | 命令行参数堆砌 |
| 生产部署 | systemd 服务（bun 绝对路径） | 手动前台 `bun run` |

> **核心结论**：Bun `--single` 单文件编译对含多个原生 `.node` 模块（sharp、onnxruntime 等）的项目**不兼容**（Bun 1.4.x 架构限制）。务必使用 `--node` 模式 + 保留 `node_modules` 结构部署——此时 ONNX Runtime / sharp 均由 `node_modules` 自带，**无需系统安装**。

---

## 八、问题排查（仅遇到问题时查看）

> 以下章节为踩坑记录与排错参考，**正常部署无需阅读**。所有问题在 Kylin V11 + x86_64 + Bun 1.4.0 实测，根因均与"误用 `--single` 模式"或"配置细节"有关。采用本文推荐的 `--node` 模式后，绝大多数问题不会出现。

### 8.1 踩坑记录

#### 坑 1：`--single` 单文件打包 + 原生模块 = 不兼容

**现象**：无论怎么放置 `libonnxruntime.so.1`，始终报：
```
error: libonnxruntime.so.1: cannot open shared object file
code: "ERR_DLOPEN_FAILED"
```

**根因**：
1. Linux 动态链接器默认**不搜索可执行文件同级目录**（与 Windows DLL 搜索规则不同）。
2. Bun `--single` 把所有文件挂载在**虚拟文件系统** `/$bunfs/root/mtranserver` 下，而 `dlopen()` 加载 `.so` / `.node` 文件需要**真实磁盘路径**，虚拟路径对其无效。

**解决**：**放弃 `--single` 单文件模式**，改用 `--node` 模式构建（保留 `node_modules` 在真实磁盘上，见第三节）。

#### 坑 2：ONNX Runtime 版本不匹配（VERS_1.27.0 not found）

**现象**：库文件放对位置后，报错升级为：
```
error: /usr/local/lib/libonnxruntime.so.1: version `VERS_1.27.0' not found
(required by /tmp/.bun-xxxxxxxx.node)
```

**根因**：MTranServer 编译时链接的是 **ONNX Runtime 1.27.0** 的符号版本；最初安装的 1.17.1 版本差太大、符号表对不上。同时 `.so` 内部 `SONAME` 为 `libonnxruntime.so.1.27.0`，`ldconfig` 只按 SONAME 注册缓存。

**解决**：安装 1.27.0 到 `/usr/local/lib` 并建立 `.so.1` 符号链接（见 8.3 节附录）。**采用 `--node` 模式后此问题不会出现**，因为 ONNX Runtime 由 `node_modules` 自带。

#### 坑 3：`sharp` 模块加载失败（Could not load the "sharp" module）

**现象**：
```
error: Could not load the "sharp" module using the linux-x64 runtime
Possible solutions:
- npm install --include=optional sharp
- npm install --os=linux --cpu=x64 sharp
```

**根因**：`sharp` ≥ 0.33 采用"主包 + 平台可选依赖"结构，linux-x64 原生二进制位于 `@img/sharp-linux-x64` 包。`--single` 打包不会正确内嵌 optionalDependencies 的平台二进制，运行时找不到 `.node` 文件。

**解决**：
1. 显式安装平台包：`npm install --cpu=x64 --os=linux --libc=glibc sharp`
2. **必须**用 `--node` 模式构建，让 bundler 保留对 `node_modules/@img/sharp-linux-x64/` 的外部引用。

#### 坑 4：`onnxruntime_binding.node` 路径错乱

**现象**：
```
error: Cannot find module '../bin/napi-v6/linux/x64/onnxruntime_binding.node'
from '/data/source/MTranServer-1/dist/main.js'
```

**根因**：Bun bundler 将 `require("onnxruntime-node")` 解析为相对路径 `../bin/napi-v6/linux/x64/onnxruntime_binding.node`；从 `dist/main.js` 往上一级定位，路径变成项目根目录下的 `bin/`，而实际文件在 `node_modules/onnxruntime-node/bin/...`。

**解决**：使用 `--node` 模式构建后，bundler 保留正确的 `node_modules` 解析逻辑（前提是 `node_modules` 在项目根目录且结构完整）。若仍报错，可在构建时加 `--external onnxruntime-node` 强制排除内联。

#### 坑 5：systemd 服务中用户名拼写错误

**现象**：服务启动失败，`journalctl` 提示用户不存在。

**根因**：原 service 文件中 `User=freeedo`（多一个 `e`），实际用户名为 `freedo`。

**解决**：修正拼写为 `freedo`。

#### 坑 6：systemd 环境下 Bun 路径找不到

**现象**：`ExecStart` 报 `bun: command not found`。

**根因**：systemd 默认 `PATH` 精简（`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`），不含用户级 `~/.bun/bin/`。

**解决**：`which bun` 确认路径后，在 `ExecStart` 中使用 bun 的**绝对路径**（如 `/home/freedo/.bun/bin/bun`）。

### 8.2 快速排错清单

| 症状 | 检查命令 | 可能原因 / 处理 |
|------|----------|----------------|
| `libonnxruntime.so.1: cannot open`（仅 `--single` 模式） | 见 8.3 节附录 | 改用 `--node` 模式，原生依赖由 `node_modules` 自带 |
| `version VERS_1.27.0 not found`（仅 `--single` 模式） | 见 8.3 节附录 | 改用 `--node` 模式即可，无需系统装 ONNX |
| `sharp` 模块加载失败 | `ls node_modules/@img/sharp-linux-x64/` | 用了 `--single` 构建 → 改用 `--node` |
| `onnxruntime_binding.node` 找不到 | `ls node_modules/onnxruntime-node/bin/napi-v6/linux/x64/` | 构建模式不对或 node_modules 缺失 |
| 图片翻译报 `ENOENT ... noto-sans-sc-*.woff2` | `ls dist/*.woff2` + 检查 `src/assets/fonts.ts` 是否用 `import.meta.url` 解析路径 | 字体路径未按 `dist/` 目录解析 → 确认已应用 fonts.ts 的 `resolveFontPath` 修复并重新 `bun run build --node` |
| 服务启动失败，用户不存在 | `id freedo` | service 文件用户名拼写错误（如 freeedo） |
| `bun: command not found` | `which bun` | systemd 中 bun 未用绝对路径 |
| 端口不通 | `ss -tlnp \| grep 8989` | 防火墙未放行或端口被占用 |

### 8.3 附录：系统安装 ONNX Runtime 1.27.0（`--single` 时代的经验教训，当前 `--node` 部署可跳过）

> 以下为早期尝试 `--single` 单文件模式时踩坑的记录，作为经验教训保留。**采用本文推荐的 `--node` 模式后，原生依赖走 `node_modules` 自带，本节内容不再需要执行。**

#### A.1 安装 ONNX Runtime 1.27.0（系统级 .so）

（仅当必须使用系统级 `libonnxruntime` 时才需要，例如 `--single` 构建）MTranServer 运行时会 `dlopen("libonnxruntime.so.1")`，且要求内部符号版本为 **VERS_1.27.0**。请直接安装 1.27.0，不要用 1.17.1 等其他版本。

```bash
cd /tmp
wget https://github.com/microsoft/onnxruntime/releases/download/v1.27.0/onnxruntime-linux-x64-1.27.0.tgz
tar -xzf onnxruntime-linux-x64-1.27.0.tgz

# 复制真实文件到系统库目录
sudo cp /tmp/onnxruntime-linux-x64-1.27.0/lib/libonnxruntime.so.1.27.0 /usr/local/lib/

# 建立符号链接（SONAME 为 libonnxruntime.so.1.27.0，链接名需为 .so.1）
sudo ln -sf /usr/local/lib/libonnxruntime.so.1.27.0 /usr/local/lib/libonnxruntime.so.1
sudo ln -sf /usr/local/lib/libonnxruntime.so.1   /usr/local/lib/libonnxruntime.so

# 确保 /usr/local/lib 在 ldconfig 扫描路径中
echo "/usr/local/lib" | sudo tee /etc/ld.so.conf.d/local.conf
sudo ldconfig

# 验证：应能看到 .so.1 与 .so.1.27.0 两条记录
ldconfig -p | grep onnxruntime
```

#### A.2 验证 ONNX Runtime 文件有效性

```bash
file /usr/local/lib/libonnxruntime.so.1.27.0
# 正常输出：ELF 64-bit LSB shared object, x86-64 ... dynamically linked ...

readelf -d /usr/local/lib/libonnxruntime.so.1.27.0 | grep SONAME
# 重点是 ldconfig -p 能查到 libonnxruntime.so.1
```
