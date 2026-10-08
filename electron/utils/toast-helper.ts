import { WebContents } from 'electron';
import { windowManager } from '../services/window-manager';
import { localizePlatformLog } from '../platforms/platform-i18n';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  persistent?: boolean;
  durationMs?: number;
}

/**
 * 平台 Toast 状态提示
 * 安全防机器人加固：
 * 绝不在第三方平台（小红书/微信）的 DOM 中注入任何外来元素，防止触发平台的 MutationObserver 与截屏风控探针；
 * 所有状态通过 Electron 顶层 IPC 广播到原生 TabBar 与应用主界面展示。
 */
export async function injectPlatformToast(
  webContents: WebContents,
  message: string,
  type: ToastType = 'info',
  optionsOrDuration?: number | ToastOptions,
  platform?: string
): Promise<void> {
  if (!webContents || webContents.isDestroyed()) return;

  // 自动推断所属平台（若未显式传参）
  let inferredPlatform = platform;
  if (!inferredPlatform) {
    if (message.includes('小红书') || message.toLowerCase().includes('xiaohongshu')) {
      inferredPlatform = 'xiaohongshu';
    } else if (message.includes('微信') || message.includes('视频号') || message.toLowerCase().includes('wechat')) {
      inferredPlatform = 'wechat';
    }
  }

  const curLang = typeof windowManager !== 'undefined' ? windowManager.getCurrentLanguage() : 'zh';
  const localizedMessage = localizePlatformLog(message, curLang);

  // 向主窗口与 TabBar 原生广播状态，确保用户随时可见，同时目标网页 DOM 保持 100% 纯净
  windowManager.broadcast('platform:status-update', {
    platform: inferredPlatform,
    message: localizedMessage,
    type,
    timestamp: Date.now(),
  });
}

/**
 * 解除当前的 Toast 提示
 */
export async function dismissPlatformToast(webContents: WebContents, platform?: string): Promise<void> {
  if (!webContents || webContents.isDestroyed()) return;
  windowManager.broadcast('platform:status-update', {
    platform,
    message: '',
    type: 'info',
    dismiss: true,
  });
}
