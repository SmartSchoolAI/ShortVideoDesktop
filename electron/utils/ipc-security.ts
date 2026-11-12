import * as path from 'path';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { isOwnSiteUrl } from '../config';

const BUILTIN_VIEW_NAMES = new Set([
  'loading-screen.html',
  'log-viewer.html',
  'render-viewer.html',
  'system-info.html',
  'tab-bar.html',
  'video-player.html',
]);

/**
 * 校验 IPC 请求发送方是否为受信任的站内页面或应用内置本地 views 视图。
 * 彻底阻断第三方平台网页（如视频号、小红书）或恶意页面越权调用高权限桌面 IPC。
 */
export function isTrustedIpcSenderUrl(senderUrl: string): boolean {
  try {
    if (!senderUrl || typeof senderUrl !== 'string') return false;
    if (senderUrl.startsWith('file://')) {
      const parsed = new URL(senderUrl);
      let decodedPath = decodeURIComponent(parsed.pathname || '');
      if (/^\/[A-Za-z]:/.test(decodedPath)) decodedPath = decodedPath.slice(1);
      const normPath = path.resolve(decodedPath);
      const baseName = path.basename(normPath);
      const parentName = path.basename(path.dirname(normPath)).toLowerCase();
      return parentName === 'views' && BUILTIN_VIEW_NAMES.has(baseName);
    }
    return isOwnSiteUrl(senderUrl);
  } catch {
    return false;
  }
}

export function isTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  try {
    const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    return isTrustedIpcSenderUrl(senderUrl);
  } catch {
    return false;
  }
}

