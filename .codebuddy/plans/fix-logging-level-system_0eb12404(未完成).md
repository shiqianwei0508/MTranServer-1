---
name: fix-logging-level-system
overview: 修复 MTranServer 日志系统三处缺陷：启动未初始化日志级别导致级别被冻结、debug 模式反而日志更少；多处裸 console 绕过 logger 不受级别控制；logConsole 与级别语义耦合导致 debug 全静默。目标是让 MT_LOG_LEVEL=debug 真正输出全部调试日志，且所有输出统一受级别与落盘控制。
todos:
  - id: init-loglevel-startup
    content: 在 src/server/index.ts 的 startServer 中 getConfig 后显式调用 logger.setLogLevel
    status: pending
  - id: convert-bare-console
    content: 将 factory.ts、engine.ts、languages.ts、main.ts 的裸 console 收敛为 logger 调用
    status: pending
  - id: verify-logic-decoupling
    content: 验证 shouldLog 优先于 logConsole，确认 debug 级别可见性与帮助信息强制输出
    status: pending
    dependencies:
      - init-loglevel-startup
      - convert-bare-console
  - id: bump-version-history
    content: 用 bun run bump 提升 patch 并在 HISTORY.md 新增修复条目
    status: pending
    dependencies:
      - verify-logic-decoupling
---

## 用户需求

评审 MTranServer 日志级别实施完整性，修复"debug 模式下日志反而更少"的问题，使日志级别覆盖所有环节且行为正确。

## 产品概述

对现有日志系统（src/logger）做一次缺陷修复与一致性收敛：确保日志级别在启动即生效、所有输出统一受级别与落盘控制、debug 级别能输出预期调试信息。

## 核心特性

- 启动阶段显式初始化日志级别，避免惰性缓存把级别锁死为默认 warn
- 将散落在 factory/engine/languages/main 中的裸 console 输出统一收敛为 logger 接口，受级别与文件落盘控制
- 明确"日志级别"与"logConsole 开关"职责边界，避免 debug 因控制台开关关闭而全静默
- 保留 important/fatal 等强制输出语义，保证启动、帮助、致命错误仍可见
- 版本号按铁则提升 patch，并在 HISTORY.md 记录本次修复

## 技术栈

- 语言：TypeScript（Node.js / Bun 运行时）
- 现有日志模块：src/logger/index.ts（debug/info/important/warn/error/fatal + setLogLevel/getLogLevel）
- 配置来源：src/config/index.ts（MT_LOG_LEVEL、logConsole、logToFile）
- 版本管理：bun run bump（scripts/bump.ts）统一提升 patch 并同步 src/version/index.ts

## 实现方案

### 策略

在不改变日志模块对外接口与"force 强制输出"设计的前提下，做三处定向修复：(1) 启动时用 setLogLevel 显式固化真实级别；(2) 把裸 console 统一改为 logger 调用；(3) 校验 logConsole 与级别解耦逻辑，确保级别过滤在 logConsole 之前生效。

### 关键技术决策

1. **启动显式 setLogLevel**：在 src/server/index.ts 的 startServer() 中、getConfig() 之后立即调用 `logger.setLogLevel(config.logLevel)`。理由：当前 getLogLevel() 惰性缓存首次读取结果，而首次 logger.info 调用发生在 startServer 早期，会把级别固化为当时 config（虽读到 debug，但缓存时机与 API 动态调整存在错位，且未显式声明意图，易回归）。显式初始化让级别确立时机确定、可测试。
2. **裸 console 收敛为 logger**：factory.ts:80、engine.ts:221/420、languages.ts:8-22、main.ts:10 改为对应 logger.warn/error/info/important。理由：裸 console 不受 shouldLog 控制，造成"debug 模式下受控日志被过滤、裸 console 却总打印"的割裂观感，正是"日志反而更少/更乱"的根因。统一后所有输出受同一级别 + logToFile 约束。
3. **logConsole 与级别解耦**：确认 logInternal 逻辑为"先 shouldLog 判断级别，再按 logConsole 决定控制台输出"。无需改 logger 主体，但需在收敛裸 console 后验证：当 logConsole=false 时，debug/info 经 logger 仍会被 shouldLog 正确过滤（而非因 logConsole 提前短路）。当前实现已是级别优先，故保持。

### 性能与可靠性

- 日志调用为同步写控制台/文件流，量级极低（每请求个位数条），收敛改动不引入新开销。
- 文件流写采用 append + 按日滚动，保持现状。
- 回归风险：帮助信息（main.ts）原用 console.log 直接打印，改为 logger 后需保证在 logger 初始化之后再输出；帮助信息属"强制可见"场景，使用 logger.important 或保持 force 输出，避免被级别吞掉。

### 避免技术债务

- 不新增日志接口，复用现有 debug/info/important/warn/error/fatal。
- 不改动已正确使用的 58+ 处业务日志调用。
- 帮助信息仅在 --help 分支触发，不进入服务主流程，影响面可控。

## 实现注意事项

- 修改 main.ts 帮助信息：当前在 import 阶段即可能触发 logger 模块加载，需确保帮助打印发生在 logger 可用且级别已设定（--help 属早期退出分支，用 logger.important 强制输出即可，不受级别影响）。
- languages.ts 的语言对列表原用 console.log 逐行打印，改为 logger.info 后受级别控制——这符合预期（debug/info 可见，warn 下安静）。
- 收敛后需在 docker/README.md 配置表确认 MT_LOG_LEVEL 取值说明已存在（之前仅写"日志级别"），无需新增。
- 版本号使用 `bun run bump` 提升 patch，勿手动改 package.json；同步 HISTORY.md 新增条目。

## 架构设计

日志系统为单例模块，调用方统一 import * as logger。修复后数据流：
用户配置(MT_LOG_LEVEL) → getConfig → startServer 显式 setLogLevel → 所有模块经 logger.debug/info/warn/error → shouldLog(级别过滤) → logConsole/file 输出。
收敛裸 console 后，不再存在绕过 shouldLog 的输出旁路。

## 目录结构

```
src/
├── logger/index.ts          # [确认] 核心日志逻辑，shouldLog/setLogLevel 现状正确，本次不改动主体
├── server/index.ts          # [MODIFY] startServer 中 getConfig() 后新增 logger.setLogLevel(config.logLevel)
├── core/factory.ts          # [MODIFY] 第80行 console.warn → logger.warn
├── core/engine.ts           # [MODIFY] 第221、420行 console.error → logger.error
├── server/languages.ts      # [MODIFY] 第8-22行 console.log 列语言对 → logger.info
├── main.ts                  # [MODIFY] 第10行帮助信息 console.log → logger.important（强制可见）
├── version/index.ts         # [由 bump 自动更新] 版本常量同步
├── config/index.ts          # [确认] 无需改动，logLevel/logConsole 默认值合理
HISTORY.md                   # [MODIFY] 顶部 v5.x 章节新增本次修复条目
package.json                 # [由 bump 自动更新] version 提升 patch
```

## 关键代码结构

日志模块接口（已存在，仅说明契约，不改动）：

- setLogLevel(level: 'debug'|'info'|'warn'|'error'): void
- debug/info/warn/error(message: string, ...args: any[]): void
- important(message: string, ...args: any[]): void  // force=true，不受级别控制
- fatal(message: string, ...args: any[]): void       // force + process.exit(1)