import fs from 'fs';
import path from 'path';
import { app, ipcMain, Notification, dialog, shell } from 'electron';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import { APP_CONFIG } from '../config';
import { getLocale, formatI18n } from '../utils/i18n';
import { windowManager } from './window-manager';

export interface UpdateStatusState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
  info?: UpdateInfo | null;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  error?: string | null;
}

export class UpdateManager {
  private static instance: UpdateManager | null = null;
  private state: UpdateStatusState = {
    status: 'idle',
    info: null,
    progressPercent: 0,
    transferredBytes: 0,
    totalBytes: 0,
    bytesPerSecond: 0,
    error: null,
  };
  private checkIntervalTimer: NodeJS.Timeout | null = null;
  private isInitialized: boolean = false;
  private isManualCheck: boolean = false;
  private silentDialog: boolean = false;

  public static getInstance(): UpdateManager {
    if (!UpdateManager.instance) {
      UpdateManager.instance = new UpdateManager();
    }
    return UpdateManager.instance;
  }

  private constructor() {}

  /**
   * 确保更新配置文件 app-update.yml 存在
   * 避免解包运行或开发测试环境下因缺失 yml 导致 ENOENT 崩溃
   */
  private ensureUpdateConfig(): void {
    try {
      const feedUrl = `${APP_CONFIG.downloadUrl.replace(/\/+$/, '')}/website/`;
      const yamlContent = [
        'owner: smartschoolai',
        'repo: ShortVideo',
        'provider: generic',
        `url: ${feedUrl}`,
        'updaterCacheDirName: shortvideo/update',
      ].join('\n') + '\n';

      // 自动清理历史遗留的独立根目录 %LOCALAPPDATA%\shortvideo-updater，归整到 shortvideo 统一目录下
      try {
        const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
        const legacyDir = path.join(localAppData, 'shortvideo-updater');
        if (fs.existsSync(legacyDir)) {
          fs.rmSync(legacyDir, { recursive: true, force: true });
        }

        // 自动清理 pending 目录中已生效的历史安装包与残留的临时碎片包，节约磁盘空间
        const pendingDir = path.join(localAppData, 'shortvideo', 'update', 'pending');
        if (fs.existsSync(pendingDir)) {
          const files = fs.readdirSync(pendingDir);
          const currentVersion = app.getVersion();
          for (const f of files) {
            const fullPath = path.join(pendingDir, f);
            if (f.endsWith('.downloading')) {
              try { fs.unlinkSync(fullPath); } catch (_) {}
            } else if (f.endsWith('.exe')) {
              // 若该安装包名称中包含当前版本号，说明应用已成功更新并运行，释放该 250MB 冗余安装包
              if (f.includes(currentVersion)) {
                try {
                  fs.unlinkSync(fullPath);
                  console.log('[UpdateManager] 🧹 已自动清理已成功生效的安装包缓存:', f);
                } catch (_) {}
              }
            }
          }
        }
      } catch (_) {}

      let hasValidConfig = false;

      // 1. 尝试在 process.resourcesPath 补充或校准 app-update.yml
      if (process.resourcesPath) {
        const defaultYmlPath = path.join(process.resourcesPath, 'app-update.yml');
        if (fs.existsSync(defaultYmlPath)) {
          try {
            const existing = fs.readFileSync(defaultYmlPath, 'utf-8');
            if (!existing.includes('updaterCacheDirName') || !existing.includes('shortvideo/update')) {
              fs.writeFileSync(defaultYmlPath, yamlContent, 'utf-8');
              console.log('[UpdateManager] 🔄 同步校准已有 resources 目录更新配置为 shortvideo/update:', defaultYmlPath);
            }
          } catch (_) {}
          hasValidConfig = true;
        } else {
          try {
            fs.writeFileSync(defaultYmlPath, yamlContent, 'utf-8');
            console.log('[UpdateManager] 自动补齐 resources 目录更新配置:', defaultYmlPath);
            hasValidConfig = true;
          } catch {
            // process.resourcesPath 在某些系统下可能只读
          }
        }
      }

      // 2. 若 resourcesPath 无法写入或不存在，则回退到可写的 userData 目录并强制指定 updateConfigPath
      if (!hasValidConfig) {
        const userDataDir = app.getPath('userData');
        if (userDataDir) {
          const fallbackYmlPath = path.join(userDataDir, 'app-update.yml');
          try {
            let needWrite = true;
            if (fs.existsSync(fallbackYmlPath)) {
              const existing = fs.readFileSync(fallbackYmlPath, 'utf-8');
              if (existing.includes('shortvideo/update') && existing.includes(feedUrl)) {
                needWrite = false;
              }
            }
            if (needWrite) {
              fs.writeFileSync(fallbackYmlPath, yamlContent, 'utf-8');
              console.log('[UpdateManager] 写入/更新 userData 目录更新配置:', fallbackYmlPath);
            }
          } catch (_) {}
          (autoUpdater as any).updateConfigPath = fallbackYmlPath;
          console.log('[UpdateManager] 绑定备用更新配置路径:', fallbackYmlPath);
        }
      }
    } catch (e: any) {
      console.warn('[UpdateManager] 检查更新配置文件异常:', e?.message || e);
    }
  }

  /**
   * 初始化自动热更新服务
   */
  public init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 确保更新配置文件就绪
    this.ensureUpdateConfig();

    // 配置更新源 Feed URL 并强制锁定本地缓存统一目录
    const feedUrl = `${APP_CONFIG.downloadUrl.replace(/\/+$/, '')}/website/`;
    try {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: feedUrl,
        updaterCacheDirName: 'shortvideo/update',
      } as any);
    } catch (e: any) {
      console.warn('[UpdateManager] 配置 Feed URL 异常:', e?.message || e);
    }

    // 强制开启 .blockmap 差量分块增量更新模式 (Differential Update via Blockmap)
    autoUpdater.disableDifferentialDownload = false;

    // 绑定 logger，将底层更新与 blockmap 比对日志流送给控制台
    autoUpdater.logger = {
      info: (msg: any) => {
        const text = typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
        console.log('[AutoUpdater]', text);
        if (text.includes('block map') || text.includes('differential')) {
          console.log('[UpdateManager] ⚡ 正在运用 [.blockmap] 执行差量增量分块下载比对...');
        }
      },
      warn: (msg: any) => console.warn('[AutoUpdater]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
      error: (msg: any) => console.error('[AutoUpdater]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
      debug: (_msg: any) => {},
    };

    // 默认不自动静默下载：检测到新版本时在界面呈现【下载更新】按钮，交由用户主动触发增量下载
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    // 绑定 autoUpdater 生命周期事件
    this.setupListeners();

    // 注册 IPC 控制指令
    this.registerIpc();

    // 在生产环境下，应用启动 6 秒后执行首次静默检测，之后每 4 小时轮询检查一次
    if (app.isPackaged) {
      setTimeout(() => {
        this.checkForUpdates(false).catch(() => {});
      }, 6000);

      this.checkIntervalTimer = setInterval(() => {
        this.checkForUpdates(false).catch(() => {});
      }, 4 * 60 * 60 * 1000);
    } else {
      console.log('[UpdateManager] 开发模式运行中 (已配置更新源: %s)，静默跳过自动热更新下载', feedUrl);
    }
  }

  private getI18n() {
    const lang = windowManager?.getCurrentLanguage?.() || 'zh';
    return getLocale(lang);
  }

  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.state.status = 'checking';
      this.state.error = null;
      this.broadcastState();
      console.log('[UpdateManager] 正在检查服务端是否有新版本...');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.state.status = 'available';
      this.state.info = info;
      this.state.error = null;
      this.broadcastState();
      console.log(`[UpdateManager] 发现客户端新版本: v${info.version} (当前版本: v${app.getVersion()})`);

      // Linux deb/rpm 用户提示手动前往官网下载
      if (process.platform === 'linux' && !process.env.APPIMAGE) {
        if (this.isManualCheck && !this.silentDialog) {
          const loc = this.getI18n();
          dialog.showMessageBox({
            type: 'info',
            title: loc.dialogs.newVersionTitle,
            message: formatI18n(loc.dialogs.newVersionMsg, { version: info.version }),
            detail: loc.dialogs.linuxManualDetail,
            buttons: [loc.dialogs.btnGoWebsite, loc.dialogs.btnRemindLater],
            defaultId: 0,
          }).then((res) => {
            if (res.response === 0) {
              shell.openExternal(APP_CONFIG.downloadUrl);
            }
          }).catch(() => {});
        }
      } else {
        // Windows/macOS 用户从顶部菜单主动检查发现新版本时，自动呼出关于窗口方便用户一键点击下载更新
        if (this.isManualCheck && !this.silentDialog) {
          try {
            const { windowManager } = require('./window-manager');
            windowManager.openAboutWindow();
          } catch (_) {}
        }
      }
      this.isManualCheck = false;
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.state.status = 'not-available';
      this.state.info = info;
      this.state.error = null;
      this.broadcastState();
      console.log(`[UpdateManager] 当前已是最新版本 (v${app.getVersion()})`);

      if (this.isManualCheck && !this.silentDialog) {
        const loc = this.getI18n();
        dialog.showMessageBox({
          type: 'info',
          title: loc.dialogs.checkUpdateTitle,
          message: loc.dialogs.alreadyLatestMsg,
          detail: formatI18n(loc.dialogs.alreadyLatestDetail, { version: app.getVersion() }),
          buttons: [loc.dialogs.btnOk],
        }).catch(() => {});
      }
      this.isManualCheck = false;
    });

    let lastLoggedPercent = -1;
    autoUpdater.on('download-progress', (progressObj) => {
      this.state.status = 'downloading';
      const pct = Math.round(progressObj.percent || 0);
      this.state.progressPercent = pct;
      this.state.transferredBytes = progressObj.transferred || 0;
      this.state.totalBytes = progressObj.total || 0;
      this.state.bytesPerSecond = progressObj.bytesPerSecond || 0;
      this.broadcastState();

      // 每跨越 25% 阶段输出一次系统日志，避免频繁刷屏的同时保证升级轨迹清晰留痕
      if (pct === 0 && lastLoggedPercent < 0) {
        lastLoggedPercent = 0;
        const totalMb = (progressObj.total / (1024 * 1024)).toFixed(2);
        console.log(`[UpdateManager] ⏬ 正在通过 [.blockmap] 差量下载新版本变动数据块 (待传输体积: ${totalMb} MB)...`);
      } else if (pct >= 25 && lastLoggedPercent < 25) {
        lastLoggedPercent = 25;
        const speedMb = (progressObj.bytesPerSecond / (1024 * 1024)).toFixed(2);
        console.log(`[UpdateManager] ⏬ [.blockmap] 差量分块下载中 (进度: 25%, 速度: ${speedMb} MB/s)`);
      } else if (pct >= 50 && lastLoggedPercent < 50) {
        lastLoggedPercent = 50;
        const speedMb = (progressObj.bytesPerSecond / (1024 * 1024)).toFixed(2);
        console.log(`[UpdateManager] ⏬ [.blockmap] 差量分块下载中 (进度: 50%, 速度: ${speedMb} MB/s)`);
      } else if (pct >= 75 && lastLoggedPercent < 75) {
        lastLoggedPercent = 75;
        const speedMb = (progressObj.bytesPerSecond / (1024 * 1024)).toFixed(2);
        console.log(`[UpdateManager] ⏬ [.blockmap] 差量分块下载中 (进度: 75%, 速度: ${speedMb} MB/s)`);
      }
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.state.status = 'downloaded';
      this.state.info = info;
      this.state.progressPercent = 100;
      this.broadcastState();
      console.log(`[UpdateManager] 🎉 客户端新版本 v${info.version} 差量安装包已就绪！提示用户重启生效。`);

      // 弹出桌面原生系统通知提醒用户
      try {
        if (Notification.isSupported()) {
          const loc = this.getI18n();
          new Notification({
            title: formatI18n(loc.notifications.updateDownloadedTitle, { version: info.version }),
            body: loc.notifications.updateDownloadedBody,
            silent: false,
          }).show();
        }
      } catch {}
      this.isManualCheck = false;
    });

    autoUpdater.on('error', (err) => {
      this.state.status = 'error';
      this.state.error = err?.message || String(err);
      this.broadcastState();
      console.warn('[UpdateManager] 自动检查或下载更新异常:', err?.message || err);

      if (this.isManualCheck && !this.silentDialog) {
        const loc = this.getI18n();
        dialog.showMessageBox({
          type: 'warning',
          title: loc.dialogs.checkUpdateTitle,
          message: loc.dialogs.updateFailedMsg,
          detail: formatI18n(loc.dialogs.updateFailedDetail, { error: err?.message || 'Network error' }),
          buttons: [loc.dialogs.btnOk],
        }).catch(() => {});
      }
      this.isManualCheck = false;
    });
  }

  private registerIpc(): void {
    ipcMain.handle('app:check-for-updates', async (_event, options?: { silentDialog?: boolean }) => {
      try {
        return await this.checkForUpdates(true, options);
      } catch (err: any) {
        return { success: false, status: 'error', message: err?.message };
      }
    });

    ipcMain.handle('app:get-update-status', () => {
      return this.getState();
    });

    ipcMain.handle('app:start-download-update', async () => {
      try {
        if (!app.isPackaged) {
          shell.openExternal(APP_CONFIG.downloadUrl);
          return { success: true, status: 'dev-mode' };
        }
        console.log('[UpdateManager] 用户主动触发新版本安装包下载...');
        this.state.status = 'downloading';
        this.broadcastState();
        await autoUpdater.downloadUpdate();
        return { success: true, status: 'downloading' };
      } catch (err: any) {
        console.error('[UpdateManager] 手动下载更新失败:', err);
        this.state.status = 'error';
        this.state.error = err?.message || String(err);
        this.broadcastState();
        return { success: false, status: 'error', message: err?.message };
      }
    });

    ipcMain.handle('app:quit-and-install', () => {
      this.quitAndInstall();
      return { success: true };
    });

    ipcMain.on('app:quit-and-install', () => {
      this.quitAndInstall();
    });
  }

  /**
   * 触发检查更新
   * @param isManual 是否为用户手动触发
   * @param options 控制参数，如 silentDialog: 仅在界面展示提示，不弹出系统原生弹窗
   */
  public async checkForUpdates(
    isManual: boolean = false,
    options?: { silentDialog?: boolean }
  ): Promise<{ success: boolean; status?: string; message?: string }> {
    this.isManualCheck = isManual;
    this.silentDialog = Boolean(options?.silentDialog);

    if (!app.isPackaged) {
      if (isManual) {
        const loc = this.getI18n();
        if (!this.silentDialog) {
          dialog.showMessageBox({
            type: 'info',
            title: loc.dialogs.devModeTitle,
            message: loc.dialogs.devModeMsg,
            detail: loc.dialogs.devModeDetail,
            buttons: [loc.dialogs.btnOk],
          }).catch(() => {});
        }
        this.state.status = 'not-available';
        this.broadcastState();
        return { success: true, status: 'dev-mode', message: loc.dialogs.devModeDetail };
      }
      return { success: false, status: 'dev-mode', message: '开发环境跳过' };
    }

    try {
      this.ensureUpdateConfig();
      await autoUpdater.checkForUpdates();
      return { success: true, status: 'checking' };
    } catch (err: any) {
      console.warn('[UpdateManager] 执行 checkForUpdates 失败:', err?.message || err);
      if (this.isManualCheck && !this.silentDialog) {
        const loc = this.getI18n();
        dialog.showMessageBox({
          type: 'warning',
          title: loc.dialogs.checkUpdateTitle,
          message: loc.dialogs.updateFailedMsg,
          detail: err?.message || loc.dialogs.updateFailedDetail,
          buttons: [loc.dialogs.btnOk],
        }).catch(() => {});
      }
      this.isManualCheck = false;
      return { success: false, status: 'error', message: err?.message || '检查更新失败' };
    }
  }

  /**
   * 退出并重启应用新版本（增量更新生效）
   */
  public quitAndInstall(): void {
    console.log('[UpdateManager] 正在退出当前客户端并重启生效新版本...');
    try {
      // 停止后台任何渲染进程，解除本地安装目录中的文件占用锁
      const { renderManager } = require('./render-manager');
      renderManager.stopRender();
    } catch {}

    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      console.error('[UpdateManager] quitAndInstall 异常:', err);
    }
  }

  public getState(): UpdateStatusState {
    return { ...this.state };
  }

  private broadcastState(): void {
    try {
      const { windowManager } = require('./window-manager');
      windowManager.broadcast('app:update-status', this.getState());
    } catch {}
  }

  public destroy(): void {
    if (this.checkIntervalTimer) {
      clearInterval(this.checkIntervalTimer);
      this.checkIntervalTimer = null;
    }
  }
}

export const updateManager = UpdateManager.getInstance();
