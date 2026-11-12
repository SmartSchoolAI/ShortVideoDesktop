import { WebContents, clipboard } from 'electron';
import { Page, Locator } from 'playwright-core';
import { PublishAbortedError } from '../platforms/base-platform';

export interface HumanTypingOptions {
  minDelay?: number;
  maxDelay?: number;
  errorRate?: number; // 输错字并回退修改的概率 (0.0 ~ 1.0)
}

/**
 * 随机延迟等待（支持通过 AbortSignal 毫秒级即刻中止）
 */
export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new PublishAbortedError('任务已被主动中止: 标签页已被关闭');
  }
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      reject(new PublishAbortedError('任务已被主动中止: 标签页已被关闭'));
    };

    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * 在 min 与 max 毫秒之间生成高斯偏好随机延迟
 */
export function getRandomDelay(minMs: number, maxMs: number): number {
  const rand = (Math.random() + Math.random()) / 2; // 逼近正态分布
  return Math.floor(minMs + rand * (maxMs - minMs));
}

/**
 * 模拟人类在复制长文本时的准备与思考时间
 */
export async function simulateClipboardHesitation(signal?: AbortSignal): Promise<void> {
  const delay = getRandomDelay(450, 1200);
  await sleep(delay, signal);
}

/**
 * 模拟人类操作动作间隔（串行操作中停顿），并在停顿期间向用户提供实时、步进式的信息提示
 * 支持 AbortSignal 瞬间中断退出
 */
export async function waitHumanInterval(
  tracer: { track: (action: string, detail?: any, level?: any, options?: any) => Promise<void>; isAborted?: () => boolean; getSignal?: () => AbortSignal | undefined },
  minMs: number,
  maxMs: number,
  hintMessage: string,
  signal?: AbortSignal
): Promise<void> {
  const effectiveSignal = signal || tracer.getSignal?.();
  if (effectiveSignal?.aborted || tracer.isAborted?.()) {
    throw new PublishAbortedError('任务已被主动中止: 标签页已被关闭');
  }
  const duration = getRandomDelay(minMs, maxMs);
  const startTime = Date.now();
  const endTime = startTime + duration;

  // 初始提示（常驻模式：直到操作结束再被替换或取消）
  const totalSec = (duration / 1000).toFixed(1);
  await tracer.track(`⏳ ${hintMessage} (预计等待 ${totalSec} 秒)...`, null, 'info', { persistent: true });

  let lastTrackTime = Date.now();

  // 持续倒计时循环（Toast 始终常驻显示，数字平滑递减）
  while (Date.now() < endTime) {
    if (effectiveSignal?.aborted || tracer.isAborted?.()) {
      throw new PublishAbortedError('任务已被主动中止: 标签页已被关闭');
    }
    const remainingMs = endTime - Date.now();
    if (remainingMs <= 0) break;

    const stepSleep = Math.min(300, remainingMs);
    await sleep(stepSleep, effectiveSignal);

    const nowLeft = endTime - Date.now();
    const nowLeftSec = Math.max(0, nowLeft / 1000).toFixed(1);

    // 每隔 300ms 刷新屏幕 Toast 倒计时，每隔 1000ms 输出一次终端日志
    const needConsoleLog = Date.now() - lastTrackTime >= 1000;
    if (needConsoleLog) {
      lastTrackTime = Date.now();
    }

    if (nowLeft > 100) {
      await tracer.track(
        `⏳ ${hintMessage} (倒计时 ${nowLeftSec}s)...`,
        null,
        'info',
        { persistent: true, silentConsole: !needConsoleLog }
      );
    }
  }
}

/**
 * 模拟人类真实复制粘贴动作 (针对 WebContents)
 */
export async function simulateHumanPaste(
  webContents: WebContents,
  text: string
): Promise<void> {
  await simulateClipboardHesitation();
  clipboard.writeText(text);

  const isMac = process.platform === 'darwin';
  webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: 'v',
    modifiers: [isMac ? 'meta' : 'control'],
  });
  webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: 'v',
    modifiers: [isMac ? 'meta' : 'control'],
  });

  await sleep(getRandomDelay(350, 650));
}

/**
 * 模拟人类键盘敲击输入 (针对 WebContents)
 */
export async function simulateHumanTyping(
  webContents: WebContents,
  text: string,
  options: HumanTypingOptions = {}
): Promise<void> {
  const { minDelay = 40, maxDelay = 130, errorRate = 0.04 } = options;
  const keyboardMistakes: Record<string, string[]> = {
    a: ['s', 'q', 'z'],
    b: ['v', 'g', 'h', 'n'],
    c: ['x', 'd', 'v'],
    d: ['s', 'e', 'r', 'f', 'c'],
    e: ['w', 'r', 'd', 's'],
    f: ['d', 'r', 't', 'g', 'v'],
    g: ['f', 't', 'y', 'h', 'b'],
    h: ['g', 'y', 'u', 'j', 'n'],
    i: ['u', 'o', 'k'],
    k: ['j', 'i', 'o', 'l'],
    m: ['n', 'j', 'k'],
    n: ['b', 'h', 'j', 'm'],
    o: ['i', 'p', 'k', 'l'],
    p: ['o', 'l'],
    s: ['a', 'w', 'e', 'd', 'x'],
    t: ['r', 'y', 'g', 'f'],
    u: ['y', 'i', 'h', 'j'],
    v: ['c', 'f', 'g', 'b'],
    w: ['q', 'e', 's'],
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (Math.random() < errorRate && /[a-z]/i.test(char)) {
      const lower = char.toLowerCase();
      const possibleMistakes = keyboardMistakes[lower] || ['x', 's', 'e'];
      const typo = possibleMistakes[Math.floor(Math.random() * possibleMistakes.length)];

      webContents.sendInputEvent({ type: 'char', keyCode: typo });
      await sleep(getRandomDelay(70, 160));
      await sleep(getRandomDelay(120, 260));
      webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
      await sleep(getRandomDelay(90, 180));
    }

    webContents.sendInputEvent({ type: 'char', keyCode: char });

    const delay = getRandomDelay(minDelay, maxDelay);
    if ([',', '，', '.', '。', '!', '！', '\n'].includes(char)) {
      await sleep(delay + getRandomDelay(150, 380));
    } else {
      await sleep(delay);
    }
  }
}

/**
 * 针对 Playwright Page 的高仿真拟人化输入
 */
export async function simulatePlaywrightTyping(
  page: Page,
  locator: Locator,
  text: string,
  options: HumanTypingOptions = {}
): Promise<void> {
  const { minDelay = 35, maxDelay = 110, errorRate = 0.03 } = options;

  // 1. 获取目标元素盒模型，计算微抖动坐标并平滑移动鼠标，杜绝瞬间瞬移和绝对几何中心点
  try {
    const box = await locator.boundingBox();
    if (box) {
      const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * Math.min(10, box.width * 0.3);
      const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * Math.min(8, box.height * 0.3);
      await page.mouse.move(targetX, targetY, { steps: Math.floor(Math.random() * 4) + 4 });
      await sleep(getRandomDelay(40, 100));
      await page.mouse.down();
      await sleep(getRandomDelay(50, 100));
      await page.mouse.up();
    } else {
      await locator.click();
    }
  } catch {
    await locator.click();
  }

  await sleep(getRandomDelay(100, 220));

  // 清空现有文字 (使用小写 a，严禁带 Shift 造成非预期行为)
  await page.keyboard.press('ControlOrMeta+a');
  await sleep(getRandomDelay(60, 120));
  await page.keyboard.press('Backspace');
  await sleep(getRandomDelay(80, 200));

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // 偶发性误触纠错 (支持字母与数字)
    if (Math.random() < errorRate && /[a-zA-Z0-9]/.test(char)) {
      const typo = 's';
      await page.keyboard.type(typo, { delay: getRandomDelay(50, 120) });
      await sleep(getRandomDelay(150, 300));
      await page.keyboard.press('Backspace');
      await sleep(getRandomDelay(80, 180));
    }

    await page.keyboard.type(char, { delay: getRandomDelay(minDelay, maxDelay) });

    if ([',', '，', '.', '。', '!', '！', '\n', '#'].includes(char)) {
      await sleep(getRandomDelay(180, 420));
    }
  }
}

/**
 * 针对 Playwright Page 的高仿真剪贴板粘贴
 * 写入系统剪贴板后按下 Ctrl+v / Meta+v，完美支持富文本话题识别与 Slate/Draft 编辑器
 */
export async function simulatePlaywrightPaste(
  page: Page,
  locator: Locator,
  text: string
): Promise<void> {
  // 平滑拟人移动并聚焦
  try {
    const box = await locator.boundingBox();
    if (box) {
      const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * Math.min(10, box.width * 0.3);
      const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * Math.min(8, box.height * 0.3);
      await page.mouse.move(targetX, targetY, { steps: Math.floor(Math.random() * 4) + 4 });
      await sleep(getRandomDelay(40, 100));
      await page.mouse.down();
      await sleep(getRandomDelay(50, 100));
      await page.mouse.up();
    } else {
      await locator.click();
    }
  } catch {
    await locator.click();
  }

  await sleep(getRandomDelay(120, 260));

  // 清空现有文字
  await page.keyboard.press('ControlOrMeta+a');
  await sleep(getRandomDelay(60, 120));
  await page.keyboard.press('Backspace');
  await sleep(150);

  // 模拟复制停顿并写入系统剪贴板
  await simulateClipboardHesitation();
  clipboard.writeText(text);

  // 发送快捷键粘贴
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+v`);
  await sleep(getRandomDelay(400, 750));
}

/**
 * 模拟人类点击操作 (针对 WebContents)
 * 生成平滑多点拟人轨迹移动 -> 按压 -> 释放，杜绝单点瞬移被反爬传感器捕获
 */
export async function simulateHumanClick(
  webContents: WebContents,
  x: number,
  y: number
): Promise<void> {
  const targetX = Math.round(x + (Math.random() - 0.5) * 4);
  const targetY = Math.round(y + (Math.random() - 0.5) * 4);

  // 模拟手部肌肉微弧度移动 (3~5 步短距离多点轨迹插值)
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const curX = Math.round(targetX - (1 - t) * 12 + (Math.random() * 2 - 1));
    const curY = Math.round(targetY - (1 - t) * 10 + (Math.random() * 2 - 1));
    webContents.sendInputEvent({
      type: 'mouseMove',
      x: curX,
      y: curY,
    });
    await sleep(getRandomDelay(10, 20));
  }

  // 最终对准目标
  webContents.sendInputEvent({
    type: 'mouseMove',
    x: targetX,
    y: targetY,
  });
  await sleep(getRandomDelay(40, 90));

  webContents.sendInputEvent({
    type: 'mouseDown',
    x: targetX,
    y: targetY,
    button: 'left',
    clickCount: 1,
  });
  await sleep(getRandomDelay(60, 120));

  webContents.sendInputEvent({
    type: 'mouseUp',
    x: targetX,
    y: targetY,
    button: 'left',
    clickCount: 1,
  });
  await sleep(getRandomDelay(70, 160));
}
