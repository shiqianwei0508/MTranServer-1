# 翻译架构边界与模型选型决策笔记

记录时间：2026-08-25
关联文档：`cpu-translation-models.md`（候选模型与接入方案调研）

## 1. 非英文 → 中文 必须走英文中转（pivot）的原理

这是**模型库数据决定的**，不是引擎逻辑偏好。

- MTranServer 使用 Mozilla `translations-models-v2` 模型库（bergamot/Marian 格式）。
- 实测 `/languages`（生产 v5.0.27）返回 107 个语言对、56 种语言，其中：
  - 含中文的对只有 `en↔zh-Hans`、`en↔zh-Hant` 4 个；
  - **完全不含 `en` 的语言对数量 = 0**——所有语言只有 `x ↔ en` 形式。
- 代码忠实于这个现实：`src/services/engine.ts` 的 `needsPivotTranslation` + `translateSegment` 的 pivot 分支：只要 `from`/`to` 都不含 `en` 且不存在直接对，就走 `源 → en → 目标`。
- 因此：**任意两个非英文语言互译、以及非英文→中文，均先翻成英文再翻出去。** 这是英语枢纽（hub-and-spoke）架构的必然。

## 2. 翻译缓存验证（生产环境实测）

- 缓存实现：`src/utils/cache.ts`（LRUCache，`config.cacheSize` 控制，默认 1000）+ `engine.ts` 的 `translateSingleLanguageText`。
- 缓存 key = `sha1(from + '\0' + to + '\0' + text)`，仅缓存句子级结果，纯内存不落盘。
- 实测 `freedotrans.gbim.vip`（v5.0.27）：相同乌克兰语→中文文本，首次 1012ms（加载引擎+推理）、不同文本 289ms（仅推理）、重发 18ms（命中缓存）。**缓存生效。**
- 默认 `logLevel=warn` 不打印 `Cache hit` 的 debug 日志（`engine.ts` 中），故不可见但确实在工作。

## 3. 其他开源离线模型是否能"直译中文"对比

| 模型 | 直译中文 | 架构 | 说明 |
|---|---|---|---|
| Mozilla bergamot（本项目） | 仅 `en↔zh` | 英语枢纽 | 非英文→中文必须 pivot |
| Meta NLLB-200 / 600 | ✅ 任意 200 语 ↔ 中文 | many-to-many | fairseq/transformers 格式，与 bergamot 不兼容 |
| Facebook M2M-100 | ✅ 100 语 ↔ 中文 | many-to-many | CPU INT8 可跑（见 `cpu-translation-models.md`） |
| Google MADLAD-400 | ✅ 450+ 语含中文 | many-to-many (T5) | 接入成本较高 |
| Helsinki-NLP Opus-MT | ⚠️ 多为 `x↔en`，有 `zh↔en` 及少量 `x↔zh` | 大量独立 Marian 模型 | 仍以英语为中心 |
| 达摩院 CSANMT | ✅ 中英互译（zh2en + en2zh 均有） | 专用 NMT（TF） | 见第 4 节 |

**结论**：主流 many-to-many 模型（NLLB/M2M/MADLAD）支持直译中文，但中文质量对主流语言未必明显碾压 pivot；只有冷门小语种直译优势明显。商业 API（DeepL/Google）对主流语言对多为直译。

## 4. CSANMT 澄清（易被误导的点）

- **不是 LLM**，是达摩院专用神经机器翻译（NMT）模型，参数量约 1.2 亿，轻量版 ~600MB。
- **支持中英互译**：ModelScope 上同时有 `damo/nlp_csanmt_translation_zh2en` 和 `damo/nlp_csanmt_translation_en2zh`（早期资料只提 zh2en 是片面的）。
- **是一系列语言对**（中英、中西等），但**没有** `uk_zh`/`ru_zh`/`ja_zh` 等非英文直译对，所以非英文→中文仍需先翻英文再 `en2zh`。
- **尺寸分两档**：
  - light ~600MB，CPU 可跑（~278ms/句，中文场景评测质量 5/5 星、综合 4.6，开源第一）；
  - **large 7GB，必须 GPU**（CPU 单次 2–4s 不可用；GPU 100–400ms）。
- 开源地址：
  - ModelScope：`https://modelscope.cn/models/damo/nlp_csanmt_translation_zh2en`
  - GitHub 部署项目：`https://github.com/CementZhang/CSANMT-Translation`（FastAPI + TF，支持多语言互译，预置 zh2en + en2zh）

## 5. 决策：不强行把 CSANMT 接入 MTranServer

**结论（用户拍板 2026-08-25）：维持现有 bergamot 架构，等 Mozilla 更新模型。**

理由：
- MTranServer 核心抽象是"每种语言一个 bergamot WASM 引擎、单进程、纯 CPU、离线"，与外部服务解耦。
- CSANMT 是 TensorFlow/Python 生态（large 需 GPU），与 bergamot（Rust/WASM）语言栈、运行模型完全不同。
- 强行接入只有三条路，代价都大：
  1. 进程内调用——不可能（语言栈不匹配）；
  2. 起独立 Python 推理服务 + MTranServer 调它——引入外部微服务，破坏单进程离线设计；
  3. 仅替换 `en→zh` 走外部——引擎出现特例分支（`if to==='zh' && from==='en' useExternal`），长期难维护。
- 为提升"最后一步中文质量"付出的架构代价不成比例。
- 当前 pivot 对俄/乌→中等主流语言实测已通顺可读，瓶颈在模型本身而非架构。

## 6. 当前模型状态（生产环境）

- `records.json` 标识 `translations-models-v2`，构建时间戳 `20260824134714`（2026-08-24），即截至 2026-08-25 的最新版。
- 文件为 `.zst` 压缩的 Marian 模型（`model.*.intgemm.alphas.bin`、`vocab.*.spm`、`lex.*.s2t.bin`），`architecture: base-memory`，与当前引擎完全匹配。
- 等 Mozilla 后续更新模型（更大/更好 `en_zh` 或新增直译对），只需重新拉 `records.json` + 模型文件，**零代码改动**即可受益。
