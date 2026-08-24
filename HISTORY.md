## v4.0.33

- 修复 HTML 翻译返回 500 错误（src/core/engine.ts）；新增 HTML 翻译测试覆盖

## v4.0.32

- 修复占位符（placeholder）被全角中文标点（fullwidthZhPunctuation）错误替换的问题，重构标点处理逻辑

## v4.0.31

- 添加中文输出标点全角化功能，默认开启

## v4.0.30

- 默认沉浸式翻译接口输入语言为 auto（因为它经常输入错误的语言代码，只能这样适配它了）
- 改进 auto 的混合语言处理逻辑

## v4.0.29

- UI：新增跟随系统主题功能
- UI：使用 IndexDB 存储历史记录，提升性能

## v4.0.28

- 桌面端：托盘菜单添加开机启动开关
- 桌面端：检测更新功能

## v4.0.27

- 添加 DeepLX 兼容接口
- 增大断句长度，提升了翻译质量，建议升级
- 修复译文标点符号格式错误的问题
- 改进 CJK 语言检测与文本预处理逻辑，新增 CJK 感知的分隔符映射
- 断句参数 `maxLengthBreak` 重命名为 `maxSentenceLength`（避免歧义）
- 改进词边界 / 断句处理

## v4.0.26

- 桌面端：新增多操作系统、多架构构建支持

## v4.0.25

- 改进构建脚本（build.ts / electron-build.ts）

## v4.0.24

- 更新构建脚本；桌面端配置简化

## v4.0.23

- 桌面端：初始化桌面应用与构建脚本，修复无法退出的问题

## v4.0.22

- UI：新增语言选择器与界面语言切换（i18n）
- UI：新增语音输入功能
- UI：多项体验改进
- 使用 `<br data-mt="n">` 作为占位符，改进译文结构

## v4.0.21

- 修复占位符 `[0]` / `{0}` 被错误翻译的问题
- 修复沉浸式翻译（imme）占位符 `{1}` 翻译错误的问题

## v4.0.20

- 发布到 npm，现在可以通过 `npm i -g mtranserver` 安装或者 `npx mtranserver` 来运行服务器啦！
- 修复语言检测的内存安全问题
- 修复混合语言检测的逻辑问题，现在能够正常翻译混合语言文本为目标语言了
- 新增 `--download` 命令，支持通过命令行批量下载语言对模型 (例如 `mtranserver --download en_zh zh_en`)
- 新增 `--languages` 命令，列出所有可下载的语言对
- UI：新增宽屏模式按钮
- UI：新增多面板并排翻译的功能
- UI：新增记忆语言、主题等功能开关的功能
- UI：新增副标题文档地址按钮
- UI：修复历史记录没有滚动条的问题

## v4.0.19

- 修复 cld2 语言检测栈溢出崩溃（增大 WASM 栈大小）
- 历史记录缓存默认上限调整为 1000

## v4.0.18

- 修复缺失的 index 文件导致的问题

## v4.0.13

- 改进 Docker 镜像构建支持，现在任何旧设备都能运行 Docker 版本啦！
- 无论新旧设备，使用 Docker 版本性能更佳！推荐使用 Docker 版本！
- Release 构建的可执行文件暂未跟进该功能，敬请期待！

## v4.0.12

- 改进日志功能 (感谢 @ApliNi)
- 新增 LRU 缓存功能 (感谢 @ApliNi)

## v4.0.11

- 修复认证功能失效的问题
- Fix authentication issue

## v4.0.10

### 中文版本

#### 性能与引擎

- 引擎重构：完成 v4 引擎重构，显著提升运行速度与稳定性。
- 内存优化：内存占用回归至 1GB 以内水平。在 Linux x64 环境下翻译《福尔摩斯探案集》时，btop 显示内存占用低于 600MB。

#### 部署与兼容性

- Docker 修复与支持：修复了 Docker 构建问题，新增标准版（xxnuo/mtranserver:latest）与兼容版（xxnuo/mtranserver:legacy）镜像。
- 多环境支持：新增对旧款 CPU (non-AVX2) 以及 Linux musl 的构建支持。

#### 新功能

- 更新检查器：新增启动时自动检查更新功能。可通过 --check-update 参数或 MT_CHECK_UPDATE 环境变量启用或禁用。

#### 已知问题

- Android 兼容性：当前版本暂时无法在 Android 设备上运行。

---

### English Version

#### Performance & Engine

- Engine Rewrite: The v4 engine has been refactored for significantly faster performance and enhanced stability.
- Memory Efficiency: Memory usage has returned to sub-1GB levels. (Tested on Linux x64 during English-to-Chinese translation of "The Adventures of Sherlock Holmes", btop usage was under 600MB).

#### Deployment & Compatibility

- Docker Improvements: Fixed Docker build issues and added support for both standard (xxnuo/mtranserver:latest) and legacy-compatible (xxnuo/mtranserver:legacy) images.
- Platform Support: Added legacy build support for non-AVX2 CPUs and Linux musl build support.

#### New Features

- Update Checker: Added automatic update checks on startup. This can be toggled via the --check-update flag or the MT_CHECK_UPDATE environment variable.

#### Known Issues

- Android Support: Temporarily unavailable on Android devices.
