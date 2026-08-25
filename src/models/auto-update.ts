import { getConfig } from '@/config/index.js';
import * as logger from '@/logger/index.js';
import { downloadModel, refreshRecords } from '@/models/index.js';

// 预置的"排名前10常用语言"。Mozilla 模型库为英语枢纽架构，自动更新仅覆盖这些语言
// 与英语(en)的双向配对。可通过 MT_AUTO_UPDATE_LANGUAGES 环境变量覆盖（逗号分隔）。
const ENGLISH = 'en';

// 单次自动更新（刷新 records + 下载前10语言）允许的最大耗时，超时即中止本次并排期下次，
// 避免网络异常时任务长时间挂起、间接影响主进程资源。
const AUTO_UPDATE_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟

let timerHandle: ReturnType<typeof setTimeout> | null = null;
let running = false;
let stopped = false;

function clampHour(hour: number): number {
  if (Number.isNaN(hour)) return 3;
  return Math.min(23, Math.max(0, Math.floor(hour)));
}

function clampTimes(times: number): number {
  if (Number.isNaN(times)) return 1;
  return Math.min(24, Math.max(1, Math.floor(times)));
}

// 计算"当天"以基准整点小时为首点、按次数均匀分摊的执行时刻。
// 例如 hour=3, times=4 => [03:12, 09:12, 15:12, 21:12]。返回当天这些时刻的 Date 列表。
function computeExecutionSlots(hour: number, times: number): Date[] {
  const now = new Date();
  const slots: Date[] = [];
  if (times <= 1) {
    const only = new Date(now);
    only.setHours(hour, 12, 0, 0);
    slots.push(only);
    return slots;
  }

  const stepMinutes = Math.floor((24 * 60) / times);
  for (let i = 0; i < times; i++) {
    const totalMinutes = hour * 60 + 12 + i * stepMinutes;
    const dayOffset = Math.floor(totalMinutes / (24 * 60));
    const minutesInDay = totalMinutes % (24 * 60);
    const slot = new Date(now);
    slot.setDate(now.getDate() + dayOffset);
    slot.setHours(Math.floor(minutesInDay / 60), minutesInDay % 60, 0, 0);
    slots.push(slot);
  }
  return slots;
}

// 返回距"下一个执行时刻"的毫秒数（下一次触发点，可能是今天稍后或明天）。
function millisecondsUntilNextRun(hour: number, times: number): number {
  const now = Date.now();
  const slots = computeExecutionSlots(hour, times);

  // slots 里可能含过去时刻（今天已过的 slot），取第一个 >= now 的；都没有则顺延到明天同序列。
  for (const slot of slots) {
    const diff = slot.getTime() - now;
    if (diff >= 0) return diff;
  }

  // 全部已过 => 取首个 slot 加一天
  const first = slots[0];
  return first.getTime() + 24 * 60 * 60 * 1000 - now;
}

async function runAutoUpdateOnce(): Promise<void> {
  const config = getConfig();

  if (config.enableOfflineMode) {
    logger.info('[auto-update] Skipped: offline mode is enabled');
    return;
  }

  if (!config.autoUpdateEnabled) {
    logger.info('[auto-update] Skipped: auto update is disabled');
    return;
  }

  logger.info('[auto-update] Starting scheduled model update...');

  // 整体超时保护：超时后 AbortSignal 触发，单次更新中止，不影响主进程，下次正常排期。
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTO_UPDATE_TIMEOUT_MS);

  try {
    await refreshRecords();
    logger.info('[auto-update] Model records refreshed');

    const languages = config.autoUpdateLanguages;
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const lang of languages) {
      if (lang === ENGLISH) continue; // en 自身无需配对
      // 英语枢纽：尝试 lang->en 与 en->lang 两个方向；缺失/已装的由 downloadModel 内部跳过。
      for (const [from, to] of [
        [lang, ENGLISH],
        [ENGLISH, lang],
      ] as const) {
        try {
          await downloadModel(from, to, undefined, undefined, undefined, controller.signal);
          successCount++;
        } catch (err: any) {
          if (controller.signal.aborted) {
            throw err; // 向上抛出，统一走超时处理
          }
          // 该语言配对不存在或下载失败：仅记日志，不中断其他语言。
          if (/No model found|Incomplete model/i.test(String(err?.message))) {
            skipCount++;
            logger.debug(`[auto-update] No model for ${from} -> ${to} (skipped)`);
          } else {
            failCount++;
            logger.warn(`[auto-update] Failed to update ${from} -> ${to}: ${err?.message || err}`);
          }
        }
      }
    }

    logger.info(
      `[auto-update] Completed. languages=${languages.length}, downloaded=${successCount}, skipped=${skipCount}, failed=${failCount}`
    );
  } catch (err: any) {
    if (controller.signal.aborted) {
      logger.warn(`[auto-update] Aborted by timeout (${AUTO_UPDATE_TIMEOUT_MS}ms)`);
    } else {
      logger.warn(`[auto-update] Update cycle failed: ${err?.message || err}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function tick(): Promise<void> {
  if (stopped) return;
  if (running) {
    // 上一轮仍在跑（极端长耗时），跳过本轮触发，直接排期下次。
    scheduleNext();
    return;
  }

  running = true;
  try {
    await runAutoUpdateOnce();
  } catch {
    // 任何意外已在内部兜底，这里不再抛出以免中断递归调度。
  } finally {
    running = false;
    scheduleNext();
  }
}

function scheduleNext(): void {
  if (stopped) return;
  const config = getConfig();
  const hour = clampHour(config.autoUpdateHour);
  const times = clampTimes(config.autoUpdateTimesPerDay);
  const delay = millisecondsUntilNextRun(hour, times);
  logger.debug(`[auto-update] Next run in ${Math.round(delay / 1000)}s (hour=${hour}, times=${times})`);
  timerHandle = setTimeout(() => {
    void tick();
  }, delay);
}

// 在 startServer 的 listen 回调内调用，启动后台自动更新调度器。
export function startAutoUpdateScheduler(): void {
  stopped = false;
  running = false;
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  const config = getConfig();
  if (!config.autoUpdateEnabled) {
    logger.info('[auto-update] Disabled by configuration; scheduler not started');
    return;
  }
  logger.info(
    `[auto-update] Scheduler started (hour=${config.autoUpdateHour}, times/day=${config.autoUpdateTimesPerDay}, languages=${config.autoUpdateLanguages.join(',')})`
  );
  scheduleNext();
}

// 在 stop() 内调用，清理定时器，防止服务关闭后仍在跑。
export function stopAutoUpdateScheduler(): void {
  stopped = true;
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  logger.info('[auto-update] Scheduler stopped');
}

export interface ManualTriggerResult {
  triggered: boolean;
  reason?: 'already-running' | 'scheduler-stopped' | 'disabled';
  message: string;
}

// 手动触发一次自动更新（供 /api/models/auto-update 接口调用）。
// 复用与定时任务完全相同的逻辑（refreshRecords + 前10语言下载、超时保护、失败隔离）。
// 不阻塞调用方：若当前已有更新在跑则直接返回未触发；否则异步执行并立即返回已触发，
// 实际结果由后台日志（[auto-update]）体现。不影响现有定时器调度。
export function triggerAutoUpdateNow(): ManualTriggerResult {
  if (stopped) {
    return {
      triggered: false,
      reason: 'scheduler-stopped',
      message: 'Scheduler is stopped (server shutting down); cannot trigger manual update.',
    };
  }

  const config = getConfig();
  if (!config.autoUpdateEnabled) {
    return {
      triggered: false,
      reason: 'disabled',
      message: 'Auto update is disabled by configuration (MT_AUTO_UPDATE_ENABLED=false).',
    };
  }

  if (running) {
    return {
      triggered: false,
      reason: 'already-running',
      message: 'An auto update is already in progress; please wait for it to finish.',
    };
  }

  // 异步执行，不 await，避免 HTTP 请求被长时间下载阻塞。
  running = true;
  logger.info('[auto-update] Manual trigger requested');
  void (async () => {
    try {
      await runAutoUpdateOnce();
    } catch {
      // runAutoUpdateOnce 内部已兜底，这里不再抛出。
    } finally {
      running = false;
    }
  })();

  return {
    triggered: true,
    message: 'Auto update triggered; check server logs ([auto-update]) for progress.',
  };
}
