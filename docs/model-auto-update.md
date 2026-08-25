# 模型自动更新（Model Auto-Update）

MTranServer 内置一个后台调度器，在**服务启动完成之后**按配置周期性地刷新 Mozilla 模型库清单，并自动下载"排名前 10 的常用语言"对应的模型，免去手动刷新与下载。全程在监听端口成功后才挂起，**不阻塞、不影响启动过程**，且有超时保护，不会卡死主进程。

## 设计要点

- **启动不下载**：调度器仅在 `app.listen` 回调内启动；`initRecords()`（仅拉清单）与 `resumePendingDownloads()` 保持不变，启动关键路径零额外开销。
- **英语枢纽架构**：Mozilla 模型库以英语（en）为中心，非 en 互译配对不存在。自动更新对每个预置语言尝试 `lang → en` 与 `en → lang` 两个方向；缺失的方向自动跳过。
- **幂等下载**：复用既有 `downloadModel`，已安装且校验通过的模型（hash 匹配）自动跳过，仅做轻量校验，几乎零带宽开销。
- **失败隔离**：单个语言 / 单个方向失败仅记日志，不中断其他语言与其他周期；一轮整体失败有兜底，不影响服务。
- **超时保护**：单次自动更新整体受 30 分钟硬超时约束（AbortController），超时即中止本轮、正常排期下次，**绝不长期挂起主进程**。
- **与 offline 模式互斥**：离线模式下自动更新静默跳过（`refreshRecords` 在 offline 下本身即拒绝）。
- **无需前端配合**：由环境变量 / `server.json` 控制，前端 `ModelManagerDialog` 已有的手动刷新 / 下载接口不受影响，无新增 UI。

## 环境变量

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `MT_AUTO_UPDATE_ENABLED` | bool | `true` | 是否启用自动更新调度器。设为 `false` 可完全关闭。 |
| `MT_AUTO_UPDATE_HOUR` | int (0–23) | `3` | 基准整点小时，作为每天**首个**执行点（固定在该整点的第 12 分钟，如 `3` → 03:12）。 |
| `MT_AUTO_UPDATE_TIMES_PER_DAY` | int (1–24) | `1` | 每天自动更新检查次数。因"最多每小时一次"，上限为 24。 |
| `MT_AUTO_UPDATE_LANGUAGES` | string (逗号分隔) | 见下 | 自动更新覆盖的语言代码列表，覆盖内置默认前 10 语言。 |

上述变量同时支持命令行参数（`--auto-update` / `--auto-update-hour` / `--auto-update-times` / `--auto-update-languages`）与 `server.json` 同名字段，三源优先级：命令行 > 环境变量 > 文件 > 内置默认。

### 默认前 10 语言

内置预置列表（按常用度排序，可在 `src/config/index.ts` 的 `DEFAULT_AUTO_UPDATE_LANGUAGES` 调整）：

```
zh, en, ja, ko, ru, fr, de, es, pt, ar
```

> `en` 在内部会被自动跳过（自身无需配对），实际触发的是其余 9 种语言与 en 的双向配对（共 18 个方向，缺失方向自动忽略）。

## 定时逻辑

以 `MT_AUTO_UPDATE_HOUR` 为首个执行点，在全天按 `MT_AUTO_UPDATE_TIMES_PER_DAY` **均匀分摊**执行时刻，相邻两次间隔不小于 1 小时（由 1–24 的取值约束保证）。

示例（基准小时=3，次数=4）：

```
03:12  09:12  15:12  21:12
```

示例（基准小时=0，次数=1，即默认配置）：

```
00:12
```

调度采用**递归 `setTimeout`**（非 `setInterval`），每次执行后重新计算"下次执行时刻"再排期，避免任务耗时导致的间隔漂移，且可随时停止清理。

## 运维注意

- 自动更新会在后台占用网络与磁盘（仅增量 / 已装跳过）；如网络受限，可设 `MT_AUTO_UPDATE_ENABLED=false` 或调整为低峰 `MT_AUTO_UPDATE_HOUR`。
- 日志关键字前缀为 `[auto-update]`，便于过滤：
  - `Scheduler started` / `Next run in …`：调度状态
  - `Model records refreshed`：清单刷新成功
  - `Completed. languages=…, downloaded=…, skipped=…, failed=…`：本轮结果汇总
  - `Aborted by timeout` / `Failed to update …`：异常（已隔离，不影响服务）
- 服务关闭（`stop()`）时会清理定时器，不会在服务退出后仍运行。

## 手动触发接口

除定时自动执行外，还提供接口**立即触发一次**自动更新流程（复用与定时任务完全相同的逻辑：刷新清单 + 下载前 10 语言模型、超时保护、失败隔离、offline 互斥）。

```
POST /api/models/auto-update
Authorization: Bearer <MT_API_TOKEN>   # 若启用了 api_token 鉴权
```

- 成功受理返回 `202 Accepted`：
  ```json
  { "triggered": true, "message": "Auto update triggered; check server logs ([auto-update]) for progress." }
  ```
- 已在更新中（返回 `200`）：`{ "triggered": false, "reason": "already-running", ... }`
- 自动更新被禁用（`MT_AUTO_UPDATE_ENABLED=false`，返回 `200`）：`{ "triggered": false, "reason": "disabled", ... }`
- 服务关闭中（返回 `200`）：`{ "triggered": false, "reason": "scheduler-stopped", ... }`

该接口**不阻塞请求**：更新在后台异步执行，进度与结果通过日志 `[auto-update]` 查看（见上文"运维注意"）。手动触发**不影响**现有定时器调度，下次定时任务仍按原节奏执行。

## 相关代码

- `src/config/index.ts`：4 个配置项与默认前 10 语言常量。
- `src/models/auto-update.ts`：调度器实现（时刻计算、超时保护、失败隔离、下载循环）。
- `src/server/index.ts`：在 `app.listen` 回调内 `startAutoUpdateScheduler()`，在 `stop()` 内 `stopAutoUpdateScheduler()`。
