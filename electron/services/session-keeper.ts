import { WebContents } from 'electron';
import { windowManager } from './window-manager';
import { getLocale } from '../utils/i18n';

export interface KeepAliveOptions {
  reloadIntervalMs?: number;
}

interface PlatformSessionState {
  platformId: string;
  webContents: WebContents;
  lastHeartbeatTime: number;
  lastReloadTime: number;
  isBusy: boolean;
}

/**
 * 平台登录会话保活系统 (PlatformSessionKeeper)
 * 核心机制：
 * 1. 深度业务 API 静默心跳探针：定期（每 60-90 秒）在对应平台页面上下文触发轻量级 API 请求（如微信助手未读统计、小红书创作者主页数据），持续刷新服务端 Session 过期时间戳；
 * 2. 模拟原生用户微活跃事件 (mousemove/focus/pointer/scroll)，防止前端框架判定挂机或进入休眠；
 * 3. 前台可见性欺骗配合：确保切走 Tab 后第三方平台的前端长连接与 WebSocket 心跳协程持续全速运行；
 * 4. 废除定时强行整页刷新 (reload())，杜绝因页面重新加载打断长连接或导致单页应用回退至登录页。
 */
export class PlatformSessionKeeper {
  private static instance: PlatformSessionKeeper;
  private sessions: Map<string, PlatformSessionState> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private destroyed = false;

  private constructor() {
    this.startLoop();
  }

  public static getInstance(): PlatformSessionKeeper {
    if (!PlatformSessionKeeper.instance) {
      PlatformSessionKeeper.instance = new PlatformSessionKeeper();
    }
    return PlatformSessionKeeper.instance;
  }

  /**
   * 注册受保护的平台标签页
   */
  public register(platformId: string, webContents: WebContents): void {
    if (!webContents || webContents.isDestroyed()) return;

    this.sessions.set(platformId, {
      platformId,
      webContents,
      lastHeartbeatTime: Date.now(),
      lastReloadTime: Date.now(),
      isBusy: false,
    });

    console.log(`[SessionKeeper] 已启动对 ${platformId} 的专属会话保活探针（静默心跳 + 活跃守护，防止后台掉线）`);
    // 注册后立即执行一次初始心跳保活
    this.probeSession(platformId, webContents);
  }

  /**
   * 取消注册（Tab 关闭时调用）
   */
  public unregister(platformId: string): void {
    if (this.sessions.has(platformId)) {
      this.sessions.delete(platformId);
      console.log(`[SessionKeeper] 已停止对 ${platformId} 的会话守护`);
    }
  }

  /**
   * 标记平台当前是否处于忙碌状态（自动化发布中）
   */
  public markPlatformBusy(platformId: string, isBusy: boolean): void {
    const s = this.sessions.get(platformId);
    if (s) {
      s.isBusy = isBusy;
      if (isBusy) {
        console.log(`[SessionKeeper] ${platformId} 标记为【任务进行中】，暂停保活探针`);
      } else {
        s.lastHeartbeatTime = Date.now();
        console.log(`[SessionKeeper] ${platformId} 任务结束，恢复常规会话保活探针`);
      }
    }
  }

  /**
   * 外部直接传入的整页刷新指令（用户主动点击刷新按钮时调用）
   */
  public reloadPlatform(platformId: string, force: boolean = false): boolean {
    const state = this.sessions.get(platformId);
    if (!state || !state.webContents || state.webContents.isDestroyed()) {
      console.warn(`[SessionKeeper] 刷新指令失败：未找到有效活跃的 ${platformId} 视图`);
      return false;
    }

    if (!force && state.isBusy) {
      console.warn(`[SessionKeeper] 拒绝刷新：${platformId} 当前正在执行发布任务`);
      return false;
    }

    const loc = getLocale(windowManager.getCurrentLanguage());
    const platformName = platformId === 'wechat'
      ? loc.platforms.wechat
      : (platformId === 'xiaohongshu' ? loc.platforms.xiaohongshu : platformId);
    console.log(`[SessionKeeper] 收到指令：正在对 ${platformName} 执行整体页面重新加载...`);

    try {
      state.lastReloadTime = Date.now();
      state.webContents.reload();

      windowManager.broadcast('platform:status-update', {
        platform: platformId,
        status: `[${loc.menu.view.reload}] ${platformName}`,
        type: 'info',
      });
      return true;
    } catch (err: any) {
      console.error(`[SessionKeeper] 执行整页刷新失败:`, err.message);
      return false;
    }
  }

  /**
   * 启动带随机抖动的保活轮询器（55~88 秒随机间隔，避免规律周期特征）
   */
  private startLoop(): void {
    if (this.timer || this.destroyed) return;

    const nextDelayMs = 55000 + Math.floor(Math.random() * 33000);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.destroyed) return;
      this.keepSessionActive();
      this.startLoop();
    }, nextDelayMs);
    this.timer.unref?.();
  }

  /**
   * 针对所有已注册平台执行轻量级活跃探针
   */
  private keepSessionActive(): void {
    for (const [platformId, state] of this.sessions.entries()) {
      if (!state.webContents || state.webContents.isDestroyed()) {
        this.sessions.delete(platformId);
        continue;
      }

      if (state.isBusy) continue;

      this.probeSession(platformId, state.webContents);
    }
  }

  /**
   * 针对单一平台注入轻量化会话探针（避免伪造不可信 mousemove/focus 事件与突发并发请求）
   */
  private probeSession(platformId: string, webContents: WebContents): void {
    if (!webContents || webContents.isDestroyed() || webContents.isLoading()) return;

    if (platformId === 'wechat') {
      const wechatProbeCode = `
        (async function() {
          try {
            if (!location.hostname.includes('channels.weixin.qq.com')) return { ok: false, reason: 'not_on_channels' };

            let token = '';
            try {
              const m = document.cookie.match(/(?:^|;\\s*)token=([^;]+)/);
              if (m) token = decodeURIComponent(m[1]);
            } catch {}

            const heartbeats = [
              '/cgi-bin/mmfinderassistant-bin/helper/helper_get_finder_unread_count',
              '/cgi-bin/mmfinderassistant-bin/auth/auth_data'
            ];

            for (let i = 0; i < heartbeats.length; i++) {
              if (i > 0) {
                await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 700)));
              }
              try {
                await fetch(heartbeats[i], {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/plain, */*'
                  },
                  body: JSON.stringify({
                    timestamp: Date.now(),
                    _token: token || undefined,
                    page: 1,
                    pageSize: 1
                  }),
                  credentials: 'include',
                  signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined
                }).then((r) => r?.body?.cancel?.().catch(() => {})).catch(() => {});
              } catch {}
            }

            const hasExpiredModal = Boolean(
              Array.from(document.querySelectorAll('div, span, p')).some(el => {
                const t = (el.textContent || '').trim();
                return t.includes('登录已过期') && el.children.length === 0;
              })
            );

            return { ok: true, hasExpiredModal, timestamp: Date.now() };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        })();
      `;

      webContents.executeJavaScript(wechatProbeCode, true).then((res) => {
        if (res?.hasExpiredModal) {
          console.warn('[SessionKeeper] ⚠️ 检测到微信视频号出现登录过期弹窗，需要重新扫码');
        }
      }).catch(() => {});

    } else if (platformId === 'xiaohongshu') {
      const xhsProbeCode = `
        (async function() {
          try {
            if (!location.hostname.includes('creator.xiaohongshu.com')) return { ok: false, reason: 'not_on_xhs' };

            const heartbeats = [
              '/api/galaxy/creator/home/personal_info',
              '/api/galaxy/creator/unread_count'
            ];

            for (let i = 0; i < heartbeats.length; i++) {
              if (i > 0) {
                await new Promise(r => setTimeout(r, 450 + Math.floor(Math.random() * 650)));
              }
              try {
                await fetch(heartbeats[i], {
                  method: 'GET',
                  headers: {
                    'Accept': 'application/json, text/plain, */*'
                  },
                  credentials: 'include',
                  signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(8000) : undefined
                }).then((r) => r?.body?.cancel?.().catch(() => {})).catch(() => {});
              } catch {}
            }

            return { ok: true, timestamp: Date.now() };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        })();
      `;

      webContents.executeJavaScript(xhsProbeCode, true).catch(() => {});
    }
  }

  /**
   * 停止所有守护任务
   */
  public destroy(): void {
    this.destroyed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.sessions.clear();
  }
}

export const sessionKeeper = PlatformSessionKeeper.getInstance();

