import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PaddleOcrService,
  V5_MOBILE_MODEL,
  V6_MEDIUM_MODEL,
  V6_SMALL_MODEL,
  V6_TINY_MODEL,
  type FlattenedPaddleOcrResult,
} from 'ppu-paddle-ocr';
import { getConfig } from '@/config/index.js';
import * as logger from '@/logger/index.js';

export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrItem {
  text: string;
  confidence: number;
  box: OcrBox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  box: OcrBox;
  items: OcrItem[];
}

export interface OcrResult {
  text: string;
  confidence: number;
  model: string;
  items: OcrItem[];
  lines: OcrLine[];
}

interface ServiceState {
  service: PaddleOcrService;
  model: string;
}

let servicePromise: Promise<ServiceState> | null = null;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

function modelFile(root: string, relativePath: string): string | null {
  const fullPath = path.join(root, ...relativePath.split('/'));
  return fs.existsSync(fullPath) ? fullPath : null;
}

function findLocalModel() {
  const root = path.join(getConfig().modelDir, 'ocr');

  // PP-OCRv6 medium（服务端高精度，离线放置优先；官方无 server 档，medium 即 v6 最高精度档）
  // 官方 PP-OCRv6_medium_det_onnx / PP-OCRv6_medium_rec_onnx 仓库内文件名为 inference.onnx，
  // 下载后统一按本仓库命名风格重命名为 PP-OCRv6_medium_det.onnx / PP-OCRv6_medium_rec.onnx
  const v6MediumRoot = path.join(root, 'pp-ocrv6-medium');
  const v6MediumDetection = modelFile(v6MediumRoot, 'PP-OCRv6/det/PP-OCRv6_medium_det.onnx');
  const v6MediumRecognition = modelFile(v6MediumRoot, 'PP-OCRv6/rec/PP-OCRv6_medium_rec.onnx');
  if (v6MediumDetection && v6MediumRecognition) {
    return {
      name: 'pp-ocrv6-medium-local',
      model: {
        detection: v6MediumDetection,
        recognition: v6MediumRecognition,
        // 官方 V6_MEDIUM_MODEL 预设使用全量字典 ppocrv6_dict.txt（50+ 语言）。
        // 切勿复用 V6_TINY_MODEL 的精简字典（ppocrv6_tiny_dict.txt）——
        // 两套字典字符集不同，CTC 字符索引对不上，识别结果会全部乱码。
        charactersDictionary: V6_MEDIUM_MODEL.charactersDictionary,
      },
    };
  }

  const v6Root = path.join(root, 'pp-ocrv6-tiny');
  const v6Detection = modelFile(v6Root, 'PP-OCRv6/det/PP-OCRv6_det_tiny.onnx');
  const v6Recognition = modelFile(v6Root, 'PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx');
  if (v6Detection && v6Recognition) {
    return {
      name: 'pp-ocrv6-tiny-local',
      model: {
        detection: v6Detection,
        recognition: v6Recognition,
        charactersDictionary: V6_TINY_MODEL.charactersDictionary,
      },
    };
  }

  const v5Root = path.join(root, 'pp-ocrv5-mobile');
  const v5Detection = modelFile(v5Root, 'PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx');
  const v5Recognition = modelFile(v5Root, 'PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx');
  if (v5Detection && v5Recognition) {
    return {
      name: 'pp-ocrv5-mobile-local',
      model: {
        detection: v5Detection,
        recognition: v5Recognition,
        charactersDictionary: V5_MOBILE_MODEL.charactersDictionary,
      },
    };
  }

  return null;
}

async function createService(): Promise<ServiceState> {
  const config = getConfig();
  const local = findLocalModel();

  // 预设（V6_SMALL_MODEL）的模型/字典经 ppu-paddle-ocr 缓存目录加载
  // （os.homedir()/.cache/ppu-paddle-ocr，容器内即 /home/node/.cache/ppu-paddle-ocr，
  // compose 挂载 ./docker/models/ocr-cache）：缓存命中直接读取、不联网；
  // 仅缓存缺失才触发联网下载。缓存文件名与 model-cache.ts 的 fetchAndCacheResource
  // 完全一致（URL path 的 basename）。
  const presetCacheDir = path.join(os.homedir(), '.cache', 'ppu-paddle-ocr');
  // model-cache.ts 用 path.basename(new URL(url).pathname)；本项目预设 URL 均无 query，
  // path.basename(url) 与之等价。
  const presetCacheReady = [
    V6_SMALL_MODEL.detection,
    V6_SMALL_MODEL.recognition,
    V6_SMALL_MODEL.charactersDictionary,
  ].every(url => fs.existsSync(path.join(presetCacheDir, path.basename(url))));

  // 候选顺序线上线下一致：本地模型（modelDir/ocr/ 下的 onnx）优先，V6_SMALL_MODEL 预设兜底。
  // 离线模式（MT_OFFLINE=true）禁止联网：本地模型缺失且预设缓存不齐全时直接报错指引，
  // 绝不尝试联网下载；缓存齐全时预设仍可从缓存正常初始化。
  if (config.enableOfflineMode && !local && !presetCacheReady) {
    throw new Error(
      `OCR is unavailable in offline mode: no local OCR model under "${path.join(config.modelDir, 'ocr')}" ` +
        `and the V6_SMALL_MODEL preset cache is incomplete ("${presetCacheDir}": need ` +
        'PP-OCRv6_small_det.ort, PP-OCRv6_small_rec.ort, ppocrv6_dict.txt). Pre-seed the cache ' +
        'or local models before enabling offline mode.'
    );
  }

  const candidates = [
    local,
    ...(config.enableOfflineMode && !presetCacheReady
      ? []
      : [{ name: 'pp-ocrv6-small-preset', model: V6_SMALL_MODEL }]),
  ].filter(Boolean) as Array<{ name: string; model: any }>;

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const service = new PaddleOcrService({
      model: candidate.model,
      recognition: {
        strategy: 'per-line',
        minimumConfidence: 0.45,
      } as any,
      detection: {
        maxSideLength: 'auto',
        minimumAreaThreshold: 24,
        paddingHorizontal: 0.45,
        paddingVertical: 0.3,
      },
      session: {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        executionMode: 'sequential',
      },
      processing: {
        engine: 'opencv',
      },
      debugging: {
        verbose: false,
        debug: false,
      },
    });

    try {
      await service.initialize();
      logger.info(`OCR service initialized with ${candidate.name}`);
      return { service, model: candidate.name };
    } catch (error) {
      lastError = error;
      logger.warn(`Failed to initialize OCR model ${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
      await service.destroy().catch(() => undefined);
    }
  }

  // 离线模式下初始化失败（如缓存文件损坏），把底层错误包装为可操作的指引，
  // 而不是只抛难排查的原始错误（如 "Failed to fetch ..."）。
  if (lastError instanceof Error && config.enableOfflineMode) {
    throw new Error(
      `${lastError.message} (offline) OCR unavailable: pre-seed the ppu-paddle-ocr preset cache ` +
        `("${presetCacheDir}": PP-OCRv6_small_det.ort, PP-OCRv6_small_rec.ort, ppocrv6_dict.txt) ` +
        `or local models under "${path.join(config.modelDir, 'ocr')}" before enabling offline mode.`
    );
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to initialize OCR service');
}

async function getService(): Promise<ServiceState> {
  if (!servicePromise) {
    servicePromise = createService();
  }
  return servicePromise;
}

function mergeBoxes(boxes: OcrBox[]): OcrBox {
  const left = Math.min(...boxes.map(box => box.x));
  const top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width));
  const bottom = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function groupLines(items: OcrItem[]): OcrLine[] {
  const sorted = [...items].sort((a, b) => {
    const ay = a.box.y + a.box.height / 2;
    const by = b.box.y + b.box.height / 2;
    if (Math.abs(ay - by) > Math.max(a.box.height, b.box.height) * 0.45) return ay - by;
    return a.box.x - b.box.x;
  });

  const groups: OcrItem[][] = [];
  for (const item of sorted) {
    const centerY = item.box.y + item.box.height / 2;
    const group = groups.find(line => {
      const lineBox = mergeBoxes(line.map(part => part.box));
      const lineCenterY = lineBox.y + lineBox.height / 2;
      return Math.abs(centerY - lineCenterY) <= Math.max(item.box.height, lineBox.height) * 0.55;
    });
    if (group) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map(group => {
    const ordered = [...group].sort((a, b) => a.box.x - b.box.x);
    const text = ordered.map(item => item.text).join(hasCjk(ordered.map(item => item.text).join('')) ? '' : ' ');
    return {
      text,
      confidence: ordered.reduce((total, item) => total + item.confidence, 0) / ordered.length,
      box: mergeBoxes(ordered.map(item => item.box)),
      items: ordered,
    };
  });
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

export async function recognizeImage(image: Buffer): Promise<OcrResult> {
  const { service, model } = await getService();
  const result = await service.recognize(toArrayBuffer(image), {
    flatten: true,
    strategy: 'per-line',
    noCache: true,
  }) as FlattenedPaddleOcrResult;

  const items = result.results
    .filter(item => item.text.trim())
    .map(item => ({
      text: item.text.trim(),
      confidence: item.confidence,
      box: {
        x: Math.max(0, Math.round(item.box.x)),
        y: Math.max(0, Math.round(item.box.y)),
        width: Math.max(1, Math.round(item.box.width)),
        height: Math.max(1, Math.round(item.box.height)),
      },
    }));

  const lines = groupLines(items);
  return {
    text: lines.map(line => line.text).join('\n'),
    confidence: result.confidence,
    model,
    items,
    lines,
  };
}

export async function cleanupOcrService(): Promise<void> {
  if (!servicePromise) return;
  const state = await servicePromise.catch(() => null);
  servicePromise = null;
  await state?.service.destroy().catch(() => undefined);
}
