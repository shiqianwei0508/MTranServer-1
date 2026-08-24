# 经验教训：offline 模式应"同一候选顺序 + 禁止联网"，而非换一套候选

> 关联版本：v5.0.25（错误做法）→ v5.0.26（纠正）。涉及文件：`src/services/ocr.ts`、`docs/deploy-linux.md`、`docker/README.md`。

## 背景

`MT_OFFLINE=true`（`enableOfflineMode`）下，OCR 图片翻译应**直接使用本地资源**，绝不触发联网下载。修复过程中走了两版弯路：

1. **v5.0.25（过度修改）**：把 `V6_SMALL_MODEL` 预设从离线候选里剔除，离线只允许本地 `models/ocr/` onnx。理由"预设需要联网下载"。
2. **纠正（v5.0.26）**：查 `ppu-paddle-ocr` 源码后发现，预设的模型/字典走 `~/.cache/ppu-paddle-ocr` 缓存，**缓存命中直接读、绝不联网**。于是恢复候选顺序（本地优先 + 预设兜底，线上线下一致），仅补充"离线时缓存缺失直接报错、不联网"的硬约束。

## 教训

### 1. 离线 ≠ 换一套候选，而是"同一候选顺序 + 禁止联网"
- offline 只是资源获取方式的约束（不允许网络），不是功能可用性的边界。
- 任何"离线模式"开关都不应改变候选/调用顺序。候选顺序是产品行为契约，线上线下一致才能保证同一份部署包行为可预期。
- 正确做法：顺序不变，只把"是否会触发网络请求"作为 offline 下的前置校验（fail-fast）。

### 2. 改依赖行为前，先读依赖源码确认机制
- 对第三方包（如 `ppu-paddle-ocr`）的下载/缓存机制**不要凭猜**。
- 本次若先读 `src/processor/model-cache.ts`（`fetchAndCacheResource`：缓存存在 `existsSync` 直接读、缺失才 `fetchArrayBufferWithRetry`）与 `src/model-catalogue.ts`（`V6_SMALL_MODEL` 三件套），第一版就不会把可用的预设禁掉。
- 关键事实核对：缓存目录 = `os.homedir()/.cache/ppu-paddle-ocr`；缓存文件名 = `path.basename(new URL(url).pathname)`。

### 3. 文档是行为契约，必须与代码一致
- 旧文档写"离线 OCR 只能使用本地模型"，这是错误表述，会误导部署者白白预置/打包资源。
- 文档变更必须与代码行为同步，改完代码后要回头核对所有相关文档段落（挂载表、目录树、离线说明、前提限制）。

### 4. offline 下必须 fail-fast，不发起任何网络请求
- 即使候选逻辑允许预设兜底，离线且缓存缺失时也要**提前抛错指引**，不能等 `fetchArrayBufferWithRetry` 联网失败才报错。
- 预检内容：`fs.existsSync` 逐个确认三件套（`PP-OCRv6_small_det.ort`、`PP-OCRv6_small_rec.ort`、`ppocrv6_dict.txt`）在缓存目录存在。
- 预检文件名算法必须与依赖内部一致（见教训 2），否则预检与真实加载对不上。

### 5. 场景矩阵（最终行为）
| 场景 | 行为 |
|------|------|
| 在线 | 本地模型优先，预设兜底（缓存缺失可联网下载） |
| 离线 + 有本地模型 | 直接用本地模型，不联网 |
| 离线 + 无本地 + 缓存齐全 | 预设从缓存加载，不联网 |
| 离线 + 无本地 + 缓存缺失 | 直接报错并给出预置指引，绝不联网 |

## 预置命令速查

```bash
CACHE=~/.cache/ppu-paddle-ocr   # 容器内即 compose 挂载的 ./docker/models/ocr-cache
mkdir -p "$CACHE"
curl -fsSL -o "$CACHE/PP-OCRv6_small_det.ort" \
  https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/detection/ort/PP-OCRv6_small_det.ort
curl -fsSL -o "$CACHE/PP-OCRv6_small_rec.ort" \
  https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ort/PP-OCRv6_small_rec.ort
curl -fsSL -o "$CACHE/ppocrv6_dict.txt" \
  https://raw.githubusercontent.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr-models/main/recognition/ppocrv6_dict.txt
```
