# 计划：支持 PP-OCRv6 medium（服务端高精度）模型 + 版本号/铁则同步

> 创建日期：2026-08-24
> 状态：已执行完成（2026-08-24），server 命名已修正为 medium
> 关联需求：升级支持 OCR v6 服务端高精度模型；修复源码版本号常量；更新铁则

---

## 重要更正（2026-08-24）

原计划与初版代码按"v6 server"命名（`pp-ocrv6-server` / `PP-OCRv6_det_server.onnx`），**经核实为错误猜测**：
**PP-OCRv6 官方没有 "server" 档位**，v6 仅三档：`tiny` / `small` / `medium`（34.5M，面向服务端）。"server" 是上一代 **PP-OCRv5** 的命名。
因此用户要的"v6 服务端高精度模型"= 官方 **PP-OCRv6_medium**。所有 `server` 命名已统一改为 `medium`。

---

## 背景

- `src/version/index.ts` 的 `VERSION` 常量停留在 `4.0.33`，而 `package.json` 已是 `5.0.20`，两者脱节。根本原因是之前升级没走 `scripts/bump.ts`，而 `bump.ts:86` 本就会自动更新该常量。
- 当前 `src/services/ocr.ts` 只支持：本地 `pp-ocrv6-tiny`、`pp-ocrv5-mobile`，以及包内置 `V6_SMALL_MODEL` preset。用户已确认：
  - **模型来源**：自己从 PaddleOCR 官方提供 PP-OCRv6 **medium** 的 det/rec onnx + 字典，代码接本地 `pp-ocrv6-medium` 目录。
  - **离线需求**：要离线可用，模型本地化到 `models/ocr/` 持久化，并升级 `get_ocr_models.sh` 支持**参数指定下载模型**。

---

## 官方下载地址（实测，供用户自取）

- HuggingFace：
  - 检测 `https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx`
  - 识别 `https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec_onnx`
  - 全系列 Collection `https://huggingface.co/collections/PaddlePaddle/pp-ocrv6`
- ModelScope（国内镜像）：
  - 检测 `https://www.modelscope.cn/models/PaddlePaddle/PP-OCRv6_medium_det_onnx`
  - 识别 `https://www.modelscope.cn/models/PaddlePaddle/PP-OCRv6_medium_rec_onnx`
- 官方 ONNX 导出教程（若仓库无现成 onnx）：`https://www.paddleocr.ai/main/version3.x/inference_deployment/others/obtaining_onnx_models.html`
- ⚠️ onnx 仓库内**实际文件名**以仓库为准，下载后告知，可微调代码路径。

---

## 任务清单

### T1. 修复源码版本号常量
- 文件：`src/version/index.ts`
- 改动：`export const VERSION = '4.0.33';` → `'5.0.20';`
- 目的：与 `package.json` 对齐。

### T2. 更新铁则（MEMORY.md）
- 文件：`.codebuddy/memory/MEMORY.md`（铁则 1 版本号自动升级章节）
- 补充：升级版本号时**必须使用 `bun run bump`（`scripts/bump.ts`）** 统一升级，切勿手动只改 `package.json` 而漏掉 `src/version/index.ts`。`bump.ts` 已包含 `updateTsFile("src/version/index.ts")`，是防漏的唯一保障。

### T3. ocr.ts 支持本地 `pp-ocrv6-medium`
- 文件：`src/services/ocr.ts`
- 改动：
  1. `findLocalModel()` 新增 `pp-ocrv6-medium` 分支，目录/文件约定：
     - 根目录：`$modelDir/ocr/pp-ocrv6-medium`
     - det：`PP-OCRv6/det/PP-OCRv6_medium_det.onnx`（统一命名风格；官方仓库内文件名为 `inference.onnx`，下载后重命名）
     - rec：`PP-OCRv6/rec/PP-OCRv6_medium_rec.onnx`
     - cls（共享）：`shared/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx`（与 v6/v5 共用）
  2. medium 暂无包内置 preset，**字典复用 `V6_TINY_MODEL.charactersDictionary`**（v6 系列字典一致，先这样接，后续如有 medium 专用字典再替换）。
  3. `createService()` 候选优先级：`[local(pp-ocrv6-medium) > local(pp-ocrv6-tiny) > local(pp-ocrv5-mobile) > V6_SMALL_MODEL preset]`。

### T4. 升级 `get_ocr_models.sh` 支持参数指定下载模型
- 文件：`get_ocr_models.sh`
- 改造：
  - `./get_ocr_models.sh v6-tiny`（默认）/ `v5-mobile` / `v6-medium` / `all`
  - `v6-medium` 分支：下载 `PP-OCRv6_medium_det.onnx` / `PP-OCRv6_medium_rec.onnx`（官方源为 `inference.onnx`，统一命名风格）及共享 cls，目标目录 `$OCR_DIR/pp-ocrv6-medium/...`。
  - 共享 cls 走 `wget -c`（幂等）。
  - 保留 `$MIRROR` 私有镜像站，附官方源（HF / ModelScope）说明注释。

### T5. 文档更新
- `docs/deploy-linux.md` OCR 模型章节：补充 `pp-ocrv6-medium` 目录结构与脚本参数用法，澄清 v6 无 server 档。

### T6. HISTORY.md 新增本 Fork 版本条目
- 按铁则 1：本 Fork 版本线 v5.x，归并为 **v5.0.21**。
- 条目：支持本地 PP-OCRv6 medium 服务端高精度模型（离线可用）、下载脚本支持参数指定模型、源码版本号常量对齐 5.0.20。

---

## 注意 / 待用户提供

- **模型 onnx 文件本身不在本次代码改动范围**：用户需从官方下载 PP-OCRv6 medium 的 det/rec onnx 放入 `models/ocr/pp-ocrv6-medium/`。
- onnx 仓库内**实际文件名**以仓库为准，下载后告知可微调 `ocr.ts` 与脚本路径。
- medium 字典暂复用 `V6_TINY_MODEL.charactersDictionary`，如官方 medium 需不同字典，后续替换。

---

## 执行顺序

T1 → T2 → T3 → T4 → T5 → T6（已完成；server→medium 修正已同步全部文件）。
