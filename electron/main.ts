import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, Notification, shell } from 'electron';
import { execSync } from 'child_process';
import path from 'path';
import { windowManager } from './services/window-manager';
import { cdpBridge } from './services/cdp-bridge';
import { ensureLocalVideoFile } from './services/downloader';
import { WechatChannelsPlatform } from './platforms/wechat-channels';
import { XiaohongshuPlatform } from './platforms/xiaohongshu';
import { PublishPayload } from './platforms/base-platform';
import { localizePlatformLog } from './platforms/platform-i18n';
import { injectPlatformToast } from './utils/toast-helper';
import { APP_CONFIG } from './config';
import { localScheduler } from './services/scheduler';
import { sessionKeeper } from './services/session-keeper';
import { setupConsoleLogger, systemLogger } from './utils/logger';
import { renderManager } from './services/render-manager';
import { updateManager } from './services/update-manager';
import { SUPPORTED_LANGUAGES, getLocale, formatI18n } from './utils/i18n';

// 启动全局日志格式化器：自动为所有控制台输出增加 [日期 时间 时区] 前缀
setupConsoleLogger();

// 强制设置 Windows 控制台输出代码页为 UTF-8 (65001)，彻底消除终端日志中的中文与 Emoji 乱码
if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch { }
  process.env.LANG = 'zh_CN.UTF-8';
  // 注册 AppUserModelId 确保 Windows 10/11 任务栏图标分组与原生 Toast 通知正常工作
  app.setAppUserModelId(APP_CONFIG.appId);
}

// 统一应用名称与 TAG 版本号（杜绝显示底层 Electron 二进制版本号）
app.setName(APP_CONFIG.appName);
try {
  (app as any).setVersion?.(APP_CONFIG.version.replace(/^v/, ''));
} catch {}

// 开启 Chromium 远程调试端口，赋能 Playwright-core 原生 CDP 直连自动化驱动
app.commandLine.appendSwitch('remote-debugging-port', `${cdpBridge.getPort()}`);

// 屏蔽 DevTools 初始化时因 Electron 未搭载全套表单组件导致的协议报错与自动化受控特性
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill,AutomationControlled');
app.commandLine.appendSwitch('log-level', '3'); // 过滤掉 Chromium 内部非致命的控制台协议警告

// ── 核心防机器人检测：全面关闭 Blink 内核自动化受控特征 ──
// 关闭 AutomationControlled 标记（navigator.webdriver 底层来源）
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-infobars'); // 消除自动化受控通知条提示
// lang 跟随系统 Chromium 默认，macOS/Linux 强制 zh-CN 会被平台识别为语言环境异常

// 启用真实 GPU 加速渲染，防止 SwiftShader 软件渲染特征暴露（WebGL 指纹）
// Linux 开发环境或无 GPU 时 ignore-gpu-blocklist 会导致崩溃，仅在 Windows/macOS 强制开启
if (process.platform !== 'linux') {
  app.commandLine.appendSwitch('enable-gpu');
  app.commandLine.appendSwitch('enable-webgl');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
} else {
  // Linux: 仅启用 WebGL，不强制覆盖 GPU blocklist
  app.commandLine.appendSwitch('enable-webgl');
  if (
    process.env.ELECTRON_NO_SANDBOX === '1' ||
    process.env.ELECTRON_DISABLE_SANDBOX === '1' ||
    process.argv.includes('--no-sandbox')
  ) {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-setuid-sandbox');
  }
}

/**
 * 设置标准桌面应用菜单（多语言支持、语言切换菜单，确保各平台快捷键畅通）
 */
function setupApplicationMenu(): void {
  const isMac = process.platform === 'darwin';
  const curLang = windowManager.getCurrentLanguage();
  const loc = getLocale(curLang);
  const m = loc.menu;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' as const, label: formatI18n(m.app.about, { app: app.name }) },
            {
              label: m.app.checkUpdate,
              click: () => {
                updateManager.checkForUpdates(true);
              },
            },
            { type: 'separator' as const },
            { role: 'services' as const, label: m.app.services },
            { type: 'separator' as const },
            { role: 'hide' as const, label: formatI18n(m.app.hide, { app: app.name }) },
            { role: 'hideOthers' as const, label: m.app.hideOthers },
            { role: 'unhide' as const, label: m.app.unhide },
            { type: 'separator' as const },
            { role: 'quit' as const, label: formatI18n(m.app.quit, { app: app.name }) },
          ],
        },
      ]
      : []),
    {
      label: m.edit.label,
      submenu: [
        { role: 'undo' as const, label: m.edit.undo },
        { role: 'redo' as const, label: m.edit.redo },
        { type: 'separator' as const },
        { role: 'cut' as const, label: m.edit.cut },
        { role: 'copy' as const, label: m.edit.copy },
        { role: 'paste' as const, label: m.edit.paste },
        { role: 'selectAll' as const, label: m.edit.selectAll },
      ],
    },
    {
      label: m.view.label,
      submenu: [
        { role: 'reload' as const, label: m.view.reload },
        { role: 'forceReload' as const, label: m.view.forceReload },
        { role: 'toggleDevTools' as const, label: m.view.toggleDevTools },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: m.view.resetZoom },
        { role: 'zoomIn' as const, label: m.view.zoomIn },
        { role: 'zoomOut' as const, label: m.view.zoomOut },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: m.view.toggleFullscreen },
      ],
    },
    {
      label: m.window.label,
      submenu: [
        { role: 'minimize' as const, label: m.window.minimize },
        { role: 'zoom' as const, label: m.window.zoom },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const, label: m.window.front }] : [{ role: 'close' as const, label: m.window.close }]),
      ],
    },
    {
      label: m.language.label,
      submenu: SUPPORTED_LANGUAGES.map((item) => ({
        label: `${item.flag}  ${item.nativeName}`,
        type: 'radio' as const,
        checked: curLang === item.code,
        click: () => {
          windowManager.setLanguage(item.code);
        },
      })),
    },
    {
      label: m.help.label,
      submenu: [
        {
          label: m.help.checkUpdate,
          click: () => {
            updateManager.checkForUpdates(true);
          },
        },
        {
          label: m.help.syslogs,
          click: () => {
            windowManager.openLogsTab();
          },
        },
        {
          label: m.help.render,
          click: () => {
            windowManager.openRenderTab();
          },
        },
        {
          label: m.help.about,
          click: () => {
            windowManager.openAboutWindow();
          },
        },
        { type: 'separator' as const },
        {
          label: m.help.officialSite,
          click: () => {
            shell.openExternal(APP_CONFIG.siteUrl);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 实例化各平台驱动
// 实例化各平台驱动
const platforms = {
  wechat: new WechatChannelsPlatform(),
  xiaohongshu: new XiaohongshuPlatform(),
};

// 监听用户关闭 Tab 动作：当上传视频按钮被点击或发布执行中，若用户关闭了平台 Tab，即刻强制中止发布任务
windowManager.onTabClose((closedTabId) => {
  if (closedTabId === 'wechat' || closedTabId === 'xiaohongshu') {
    const driver = platforms[closedTabId];
    if (driver && driver.isPublishing()) {
      console.warn(`[WindowManager] 🚨 检测到用户已关闭【${driver.name}】标签页，正在即刻强行中止发布任务...`);
      driver.abortPublish(`用户关闭了【${driver.name}】标签页，自动化发布任务已强行中止`);
    }
  }
});

/**
 * 核心发布执行函数（供手动即时发布和后台定时调度器共同复用）
 */
async function executePlatformPublishCore(
  platform: 'wechat' | 'xiaohongshu',
  payload: PublishPayload,
  sendStatus: (status: string) => void
): Promise<{ success: boolean; platform: string; message: string }> {
  sessionKeeper.markPlatformBusy(platform, true);
  const curLang = windowManager.getCurrentLanguage();
  try {
    // 严格遵循规范：微信与小红书未登录时均优先打开官方主页进行登录确认，待扫码登录完成后再进入发布页
    const initialUrl = APP_CONFIG.platforms[platform]?.homeUrl || APP_CONFIG.platforms[platform]?.publishUrl;
    const platformAdapter = windowManager.openPlatformTab(platform, initialUrl);
    const platformContents = platformAdapter?.webContents;

    const loc = getLocale(curLang);
    const platformName = platform === 'wechat' ? loc.platforms.wechat : loc.platforms.xiaohongshu;
    const titleDesc = payload.title ? `【${payload.title}】` : '';
    const startNotice = formatI18n(loc.notifications.startPublishBody, {
      title: titleDesc,
      platform: platformName,
    });

    // 1. 立即广播详细发布状态及横幅通知
    sendStatus(startNotice);
    windowManager.broadcast('platform:status-update', {
      platform,
      status: startNotice,
      message: startNotice,
      type: 'info',
      inProgress: true,
      estimatedTime: '1-3分钟',
      banner: {
        show: true,
        title: formatI18n(loc.notifications.startPublishTitle),
        detail: startNotice,
      },
      timestamp: Date.now(),
    });

    // 2. 尝试弹出系统桌面原生通知（静默兼容）
    try {
      if (Notification && Notification.isSupported()) {
        new Notification({
          title: loc.notifications.startPublishTitle,
          body: startNotice,
          silent: false,
        }).show();
      }
    } catch { }

    const dlStartMsg = localizePlatformLog('⏳ 正在从远程服务器下载短视频至本地临时缓存...', curLang);
    sendStatus(dlStartMsg);
    if (platformContents && !platformContents.isDestroyed()) {
      injectPlatformToast(platformContents, dlStartMsg, 'info', { persistent: true });
    }

    let localPath = '';
    try {
      if (payload.videoUrl) {
        let lastPct = '';
        localPath = await ensureLocalVideoFile(payload.videoUrl, (_down, _total, pct) => {
          // 每次进度更新时检查标签页是否已被用户关闭
          if (platformAdapter.isClosed()) {
            throw new Error(`用户已关闭【${APP_CONFIG.platforms[platform]?.name || platform}】标签页，素材下载已中止`);
          }
          if (pct !== lastPct) {
            lastPct = pct;
            const downMsg = localizePlatformLog(`⏳ 正在下载远程视频素材 (${pct})...`, curLang);
            sendStatus(downMsg);
            if (platformContents && !platformContents.isDestroyed()) {
              injectPlatformToast(platformContents, downMsg, 'info', { persistent: true });
            }
          }
        });

        if (platformAdapter.isClosed()) {
          throw new Error(`用户已关闭【${APP_CONFIG.platforms[platform]?.name || platform}】标签页，发布任务已中止`);
        }

        const dlSuccessMsg = localizePlatformLog('✅ 远程短视频已成功下载至本地临时缓存！', curLang);
        sendStatus(dlSuccessMsg);
        if (platformContents && !platformContents.isDestroyed()) {
          injectPlatformToast(platformContents, dlSuccessMsg, 'success', { durationMs: 2500 });
        }
      }
    } catch (dlErr: any) {
      if (platformAdapter.isClosed() || dlErr?.message?.includes('中止') || dlErr?.message?.includes('关闭')) {
        throw new Error(`用户已关闭【${APP_CONFIG.platforms[platform]?.name || platform}】标签页，发布任务已中止`);
      }
      console.warn(`[IPC] Video download failed / 素材下载失败:`, dlErr?.message || dlErr);
      const dlFailMsg = localizePlatformLog(`❌ 视频素材下载失败: ${dlErr?.message || '无法获取远程文件'}`, curLang);
      sendStatus(dlFailMsg);
      if (platformContents && !platformContents.isDestroyed()) {
        injectPlatformToast(platformContents, dlFailMsg, 'error', { durationMs: 4000 });
      }
      return {
        success: false,
        platform,
        message: dlFailMsg,
      };
    }

    const driver = platforms[platform];
    if (!driver) {
      throw new Error(`Unsupported platform driver: ${platform}`);
    }

    if (!platformAdapter || platformAdapter.isClosed()) {
      throw new Error(`用户已关闭【${APP_CONFIG.platforms[platform]?.name || platform}】标签页，发布任务已中止`);
    }

    console.log(`[IPC] Starting ${platform} driver.executePublish (Language: ${curLang})...`);
    const result = await driver.executePublish(platformAdapter, localPath, payload, sendStatus, curLang);
    return result;
  } catch (err: any) {
    const isAborted = Boolean(err?.isAborted || err?.name === 'PublishAbortedError' || err?.message?.includes('中止') || err?.message?.includes('关闭'));
    if (isAborted) {
      console.warn(`[IPC] 🛑 发布至 ${platform} 已被主动中止:`, err.message);
      const abortMsg = localizePlatformLog(`视频发布任务已中止: 用户关闭了【${APP_CONFIG.platforms[platform]?.name || platform}】标签页`, curLang);
      sendStatus(abortMsg);
      return {
        success: false,
        platform,
        message: err.message ? localizePlatformLog(err.message, curLang) : abortMsg,
      };
    }
    console.error(`[IPC] 发布至 ${platform} 异常:`, err);
    const errMsg = localizePlatformLog(`发布流程遇到错误: ${err.message}`, curLang);
    sendStatus(errMsg);
    return {
      success: false,
      platform,
      message: err.message ? localizePlatformLog(err.message, curLang) : errMsg,
    };
  } finally {
    sessionKeeper.markPlatformBusy(platform, false);
  }
}

/**
 * 注册 IPC 接口通信处理器
 */
function registerIpcHandlers(): void {
  // 1. 在当前窗口打开平台 Tab 标签页
  ipcMain.handle('platform:open-window', async (_event, platform: 'wechat' | 'xiaohongshu') => {
    try {
      windowManager.openPlatformTab(platform);
      return { success: true };
    } catch (err: any) {
      console.error(`[IPC] 打开平台标签页失败 (${platform}):`, err);
      return { success: false, error: err.message };
    }
  });

  // 2. 自动化发布短视频与文案
  ipcMain.handle(
    'platform:publish',
    async (_event, { platform, payload }: { platform: 'wechat' | 'xiaohongshu'; payload: PublishPayload }) => {
      console.log(`[IPC platform:publish] 收到 ${platform} 自动化发布指令:`, {
        title: payload?.title,
        videoUrl: payload?.videoUrl,
      });
      const sendStatus = (status: string) => {
        windowManager.broadcast('platform:status-update', { platform, status });
      };
      return await executePlatformPublishCore(platform, payload, sendStatus);
    }
  );

  // 3. 接收直接传入的整体页面平滑刷新指令
  ipcMain.handle('platform:reload', async (_event, { platform, force }: { platform: 'wechat' | 'xiaohongshu'; force?: boolean }) => {
    try {
      const ok = sessionKeeper.reloadPlatform(platform, force);
      return { success: ok };
    } catch (err: any) {
      console.error(`[IPC] 执行平台整页刷新指令失败 (${platform}):`, err);
      return { success: false, error: err.message };
    }
  });

  // 4. 定时发布调度器 (Scheduler) 管理
  ipcMain.handle('scheduler:add-tasks', (_event, tasks: any[]) => {
    return localScheduler.addTasks(tasks);
  });
  ipcMain.handle('scheduler:get-tasks', () => {
    return localScheduler.getAllTasks();
  });
  ipcMain.handle('scheduler:cancel-task', (_event, id: string) => {
    return localScheduler.cancelTask(id);
  });
  ipcMain.handle('scheduler:retry-failed', () => {
    return localScheduler.retryFailedTasks();
  });

  // 5. 获取应用信息
  ipcMain.handle('app:get-info', () => {
    return {
      name: APP_CONFIG.appName,
      version: APP_CONFIG.version,
      isPackaged: app.isPackaged,
      platform: process.platform,
      language: windowManager.getCurrentLanguage(),
      userData: app.getPath('userData'),
      logPath: systemLogger.getCurrentLogFilePath(),
    };
  });

  // 6. 打开或切换到系统运行日志 Tab 标签页
  ipcMain.handle('app:open-logs', () => {
    windowManager.openLogsTab();
    return { success: true };
  });
}

import { oauthBridge } from './services/oauth-bridge';

// 保证单实例运行
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  // 二次实例唤起：激活主窗口
  app.on('second-instance', () => {
    const main = windowManager.getMainWindow();
    if (main && !main.isDestroyed()) {
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    }
  });

  app.whenReady().then(() => {
    // 初始化本地 OAuth 凭证同步服务（使用本地 127.0.0.1 Loopback HTTP 服务）
    oauthBridge.init(async (payload) => {
      await windowManager.applyAuthToken(payload.token, payload.user);
    });

    // 初始化客户端静默差量/热更新服务 (自动连接 Cloudflare R2 Feed)
    updateManager.init();
    // 全局覆盖 User-Agent：抹除 Electron/NodeJS 标识，对标真实 Windows Chrome 128
    // defaultSession 兜底保障，防止任何未经 openPlatformTab 的 session 残留机器人特征
    const { session } = require('electron');
    const realUA = APP_CONFIG.userAgent;
    app.userAgentFallback = realUA;
    session.defaultSession.setUserAgent(realUA);

    // 全局兜底拦截所有新创建的 WebContents（包含 OAuth 弹窗、iframe、子窗口）
    // 注意：Google 账号登录页对浏览器原生 API 完整性有严格检测，切勿向其注入 stealth
    const OAUTH_SKIP_STEALTH_HOSTS = [
      'accounts.google.com',
      'myaccount.google.com',
      'oauth2.googleapis.com',
      'signin.google.com',
      'google.com',
      'gstatic.com',
      'googleusercontent.com',
    ];
    const GOOGLE_OAUTH_PREFIXES = [
      'https://accounts.google.com',
      'https://myaccount.google.com',
      'https://oauth2.googleapis.com',
      'https://signin.google.com',
    ];
    app.on('web-contents-created', (_event, contents) => {
      try {
        contents.setMaxListeners(100);
        contents.setUserAgent(realUA);

        // 注意：OAuth 导航由 WindowManager 统一管理与处理，切勿在此重复注册 will-navigate 拦截，避免多开与流程冲突

        // 延迟检测 URL，等页面加载后再决定是否注入 stealth
        contents.on('did-navigate', (_e, url) => {
          try {
            const host = new URL(url).hostname;
            const isOAuthPage = OAUTH_SKIP_STEALTH_HOSTS.some((h) => host === h || host.endsWith('.' + h));
            if (!isOAuthPage) {
              windowManager.injectStealth(contents);
            }
          } catch {}
        });
        // 首次 dom-ready 前也注入（非 OAuth 页面的默认路径）
        contents.once('dom-ready', () => {
          try {
            const url = contents.getURL() || '';
            const host = url ? new URL(url).hostname : '';
            const isOAuthPage = OAUTH_SKIP_STEALTH_HOSTS.some((h) => host === h || host.endsWith('.' + h));
            if (!isOAuthPage) {
              windowManager.injectStealth(contents);
            }
          } catch {}
        });
      } catch (e) {}
    });

    setupApplicationMenu();
    windowManager.onLanguageChange(() => {
      setupApplicationMenu();
    });
    registerIpcHandlers();

    // 初始化本地定时任务调度器：注册到期自动执行上传处理函数
    localScheduler.init(async (task) => {
      if (task.platform !== 'wechat' && task.platform !== 'xiaohongshu') {
        return { success: false, message: `平台 ${task.platform} 暂未支持自动化驱动` };
      }
      const sendStatus = (status: string) => {
        windowManager.broadcast('platform:status-update', { platform: task.platform, status });
      };
      const res = await executePlatformPublishCore(task.platform, {
        videoId: task.taskId,
        videoUrl: task.videoUrl,
        title: task.title,
        description: task.description,
        tags: task.tags,
      }, sendStatus);
      return res;
    });

    // 预加载脚本路径（支持打包后与开发时）
    const preloadPath = path.join(__dirname, 'preload.js');
    windowManager.createMainWindow(preloadPath);

    // 客户端打开时：同时打开主站、系统日志和视频渲染三个TAB，主站是选中的TAB，后台自动启动视频渲染
    // 统一初始化辅助 TAB 视图（系统日志与视频渲染后台进程）
    const ensureDefaultAuxTabs = () => {
      setTimeout(() => {
        try {
          console.log('[Main] 正在就绪【系统运行日志】与【视频渲染】TAB，主站保持激活选中...');
          windowManager.openLogsTab(false);
          windowManager.openRenderTab(false);
          renderManager.startRender();
          windowManager.switchTab('main');
        } catch (err: any) {
          console.error('[Main] 自动初始化 TAB 失败:', err);
        }
      }, 400);
    };

    ensureDefaultAuxTabs();

    app.on('activate', () => {
      const main = windowManager.getMainWindow();
      if (!main || main.isDestroyed() || BrowserWindow.getAllWindows().length === 0) {
        windowManager.createMainWindow(preloadPath);
        ensureDefaultAuxTabs();
      } else {
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
      }
    });
  });

  app.on('before-quit', async () => {
    try {
      renderManager.stopRender();
    } catch { }
    try {
      updateManager.destroy();
    } catch { }
    oauthBridge.destroy();
    await cdpBridge.disconnect();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // macOS 惯例: 关闭所有窗口不退出应用
      // Windows/Linux: 关闭所有窗口时退出应用（process.exit 已去除，交由 app.quit 统一处理）
      app.quit();
    }
  });
}
