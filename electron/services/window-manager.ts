import { BrowserWindow, BrowserView, session, app, ipcMain, WebContents, Menu, MenuItemConstructorOptions, shell, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { APP_CONFIG } from '../config';
import { STEALTH_SCRIPT } from '../stealth/anti-detection';
import { cdpBridge, CdpPageClient } from './cdp-bridge';
import { sessionKeeper } from './session-keeper';
import { systemLogger } from '../utils/logger';
import { renderManager } from './render-manager';
import { oauthBridge } from './oauth-bridge';
import { SUPPORTED_LANGUAGES, SupportedLanguageItem, getLocale, normalizeLangCode } from '../utils/i18n';

export { SUPPORTED_LANGUAGES, SupportedLanguageItem, getLocale, normalizeLangCode };


export interface TabData {
  id: string;
  title: string;
  closable: boolean;
  view: BrowserView;
}

export interface PlatformTabAdapter {
  webContents: WebContents;
  loadURL: (url: string) => Promise<void>;
  show: () => void;
  focus: () => void;
  getCdpClient: () => Promise<CdpPageClient>;
  isClosed: () => boolean;
}

const TAB_BAR_SINGLE_HEIGHT = 38;
const TAB_BAR_DOUBLE_HEIGHT = 76;

export class WindowManager {
  public static getInstance(): WindowManager {
    return windowManager;
  }

  private mainWindow: BrowserWindow | null = null;
  private tabBarView: BrowserView | null = null;
  private loadingView: BrowserView | null = null;
  private isLoadingVisible: boolean = false;
  private tabs: Map<string, TabData> = new Map();
  private activeTabId: string = 'main';
  private isTabBarIpcInitialized: boolean = false;
  private isMainAppLoaded: boolean = false;
  private logViewerWindow: BrowserWindow | null = null;
  private aboutWindow: BrowserWindow | null = null;
  private tabCloseListeners: Array<(tabId: string) => void> = [];
  private languageChangeListeners: Array<(lang: string) => void> = [];
  private configuredSessions: Set<string> = new Set();
  private currentLanguage: string = 'zh';
  private oauthWindow: BrowserWindow | null = null;
  private stealthInjectedContents: WeakSet<WebContents> = new WeakSet();

  private loadPersistedLanguage(): string {
    try {
      const configPath = path.join(app.getPath('userData'), 'app-settings.json');
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const data = JSON.parse(raw);
        if (data.language && SUPPORTED_LANGUAGES.some((l) => l.code === data.language)) {
          return data.language;
        }
      }
    } catch { }
    return 'zh';
  }

  private persistLanguage(lang: string): void {
    try {
      const configPath = path.join(app.getPath('userData'), 'app-settings.json');
      let currentData: any = {};
      if (fs.existsSync(configPath)) {
        try {
          currentData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        } catch { }
      }
      currentData.language = lang;
      fs.writeFileSync(configPath, JSON.stringify(currentData, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[WindowManager] 保存语言配置失败:', err);
    }
  }

  public getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * 获取当前客户端生效的语言代码
   */
  public getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * 全局设置并同步应用语言（9种语言支持）
   */
    /**
   * 根据当前或指定语言获取对应 Tab 的本地化显示标题
   */
  public getTabDisplayTitle(tabId: string, lang?: string): string {
    const loc = getLocale(lang || this.currentLanguage);
    if (tabId === 'main') return APP_CONFIG.appName;
    if (tabId === 'syslogs') return loc.menu.help.syslogs || 'System Logs';
    if (tabId === 'render') return loc.menu.help.render || 'Video Rendering';
    if (tabId === 'wechat') return loc.platforms.wechat || 'Channels';
    if (tabId === 'xiaohongshu') return loc.platforms.xiaohongshu || 'Xiaohongshu';
    const tab = this.tabs.get(tabId);
    return tab?.title || tabId;
  }

  public setLanguage(lang: string): void {
    if (!lang) return;
    const targetLang = lang.toLowerCase();
    const item = SUPPORTED_LANGUAGES.find((l) => l.code === targetLang);
    if (!item && targetLang !== 'zh') return;
    this.currentLanguage = targetLang;
    this.persistLanguage(this.currentLanguage);
    console.log(`[WindowManager] 切换客户端语言至: ${this.currentLanguage} (${item?.name || '中文'})`);

    // 1. 同步通知 TabBar 原生标签栏
    if (this.tabBarView && !this.tabBarView.webContents.isDestroyed()) {
      this.tabBarView.webContents.send('tabbar:language-change', this.currentLanguage);
    }

    // 2. 同步通知 Loading 遮罩层
    if (this.loadingView && !this.loadingView.webContents.isDestroyed()) {
      this.loadingView.webContents.send('loading:language-change', this.currentLanguage);
    }

    // 2. 同步通知主站 Web (Next.js) 页面切换路由与本地缓存
    const mainTab = this.tabs.get('main');
    if (mainTab && !mainTab.view.webContents.isDestroyed()) {
      mainTab.view.webContents.send('app:language-change', this.currentLanguage);
      mainTab.view.webContents
        .executeJavaScript(`
          (function() {
            try {
              if (typeof window === 'undefined') return;
              const targetLang = '${this.currentLanguage}';
              localStorage.setItem('appLang', targetLang);
              localStorage.setItem('i18nextLng', targetLang);
              localStorage.setItem('oauth_redirect_lang', targetLang);
              const curPath = window.location.pathname;
              const langCodes = ['zh', 'en', 'ja', 'ko', 'vi', 'th', 'id', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'tr'];
              const regex = new RegExp('^/(' + langCodes.join('|') + ')([/\\\\?#]|$)', 'i');
              let targetPath = curPath;
              if (regex.test(curPath)) {
                targetPath = curPath.replace(regex, '/' + targetLang + '$2');
              } else {
                targetPath = '/' + targetLang + (curPath.startsWith('/') ? curPath : '/' + curPath);
              }
              if (window.location.pathname !== targetPath) {
                window.location.href = targetPath + window.location.search + window.location.hash;
              }
            } catch (err) {
              console.warn('[Electron LangSync] failed:', err);
            }
          })();
        `)
        .catch(() => { });
    }

    // 3. 同步系统日志 Tab
    const syslogTab = this.tabs.get('syslogs');
    if (syslogTab && !syslogTab.view.webContents.isDestroyed()) {
      syslogTab.view.webContents.send('syslog:language-change', this.currentLanguage);
    }

    // 4. 同步视频渲染 Tab
    const renderTab = this.tabs.get('render');
    if (renderTab && !renderTab.view.webContents.isDestroyed()) {
      renderTab.view.webContents.send('render:language-change', this.currentLanguage);
    }

    // 5. 同步关于/系统说明窗口
    if (this.aboutWindow && !this.aboutWindow.isDestroyed()) {
      this.aboutWindow.webContents.send('app:language-change', this.currentLanguage);
    }

    // 6. 更新所有现有 Tab 的 title 标题
    const loc = getLocale(this.currentLanguage);
    for (const [id, tab] of this.tabs.entries()) {
      tab.title = this.getTabDisplayTitle(id, this.currentLanguage);
    }
    this.notifyTabBarState();

    // 动态同步更新系统原生窗口标题（包含当前激活功能模块多语言名称）
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const activeTitle = this.getTabDisplayTitle(this.activeTabId, this.currentLanguage);
      const windowTitle = activeTitle && this.activeTabId !== 'main'
        ? `${activeTitle} - ${APP_CONFIG.appName}`
        : APP_CONFIG.appName;
      this.mainWindow.setTitle(windowTitle);
    }

    // 7. 触发所有注册的应用级语言变更监听器 (如动态刷新原生系统菜单)
    for (const listener of this.languageChangeListeners) {
      try {
        listener(this.currentLanguage);
      } catch (err: any) {
        console.error('[WindowManager] 触发语言变更监听器异常:', err?.message || err);
      }
    }
  }

  /**
   * 注册客户端语言变更监听器 (如供 main.ts 动态刷新原生应用菜单)
   */
  public onLanguageChange(listener: (lang: string) => void): () => void {
    this.languageChangeListeners.push(listener);
    return () => {
      this.languageChangeListeners = this.languageChangeListeners.filter((l) => l !== listener);
    };
  }

  /**
   * 弹出操作系统原生多语言选择菜单 (包含全部 9 种语言)
   */
  public showLanguageMenu(x?: number, y?: number): void {
    const menuTemplate: MenuItemConstructorOptions[] = SUPPORTED_LANGUAGES.map((item) => ({
      label: `${item.flag}  ${item.nativeName}`,
      type: 'radio',
      checked: this.currentLanguage === item.code,
      click: () => {
        this.setLanguage(item.code);
      },
    }));

    const menu = Menu.buildFromTemplate(menuTemplate);
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (typeof x === 'number' && typeof y === 'number') {
        menu.popup({
          window: this.mainWindow,
          x: Math.round(x),
          y: Math.round(y),
        });
      } else {
        menu.popup({ window: this.mainWindow });
      }
    }
  }

  /**
   * 注册 Tab 关闭监听器（供平台发布任务在用户关闭 Tab 时毫秒级即刻中止）
   */
  public onTabClose(listener: (tabId: string) => void): () => void {
    this.tabCloseListeners.push(listener);
    return () => {
      this.tabCloseListeners = this.tabCloseListeners.filter((l) => l !== listener);
    };
  }

  /**
   * 创建主应用窗口（内置 Chrome 风格多 Tab 标签栏体系）
   */
  createMainWindow(preloadPath: string): BrowserWindow {
    this.currentLanguage = this.loadPersistedLanguage();

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
      this.mainWindow.focus();
      return this.mainWindow;
    }

    const resolvedIcon = this.resolveAppIcon();
    let appIcon: any = undefined;
    if (resolvedIcon) {
      try {
        const nativeImg = nativeImage.createFromPath(resolvedIcon);
        appIcon = !nativeImg.isEmpty() ? nativeImg : resolvedIcon;
      } catch {
        appIcon = resolvedIcon;
      }
    }

    // macOS 原生 Dock 图标设置 (开发与生产统一兜底)
    if (process.platform === 'darwin' && app.dock && appIcon) {
      try {
        const dockImg = typeof appIcon === 'string' ? nativeImage.createFromPath(appIcon) : appIcon;
        if (!dockImg.isEmpty()) {
          app.dock.setIcon(dockImg);
        }
      } catch { }
    }

    this.mainWindow = new BrowserWindow({
      width: APP_CONFIG.window.width,
      height: APP_CONFIG.window.height,
      minWidth: APP_CONFIG.window.minWidth,
      minHeight: APP_CONFIG.window.minHeight,
      title: APP_CONFIG.appName,
      icon: appIcon,
      autoHideMenuBar: true, // 隐藏老式菜单栏，以现代顶部 TabBar 为核心
      backgroundColor: '#f8fafc',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // 主窗口是纯容器，不直接渲染跨域内容，保持默认安全策略
        // 切勿将此处设为 false，否则 Google OAuth 会拒绝（"此应用可能不安全"）
      },
    });

    // 提高 EventEmitter 监听器上限，避免窗口与视图绑定时的内存泄漏虚假警告
    this.mainWindow.setMaxListeners(100);
    this.mainWindow.webContents.setMaxListeners(100);

    // 配置全局会话放行自有素材域名的 CORS 限制（彻底解决 download.shortvideo.ca 跨域阻断）
    this.configureSessionInterceptors(session.defaultSession, 'default');

    this.bindDevToolsShortcut(this.mainWindow.webContents);

    // 1. 创建顶部标签栏 TabBar BrowserView
    this.createTabBarView();

    // 2. 创建加载遮罩 Loading View (优先挂载，在主站首屏加载时提供即时视觉反馈)
    this.createLoadingView();

    // 3. 创建主站 Tab 视图
    this.createMainAppTab(preloadPath);

    // 4. 监听窗口尺寸变化，动态对齐标签栏与内容区
    this.mainWindow.on('page-title-updated', (e) => e.preventDefault());

    this.mainWindow.on('resize', () => {
      this.updateLayoutBounds();
    });

    this.mainWindow.on('maximize', () => {
      this.updateLayoutBounds();
    });

    this.mainWindow.on('unmaximize', () => {
      this.updateLayoutBounds();
    });

    // macOS 原生全屏切换监听 (全屏进入与退出时重新计算视口高度，防止黑边)
    this.mainWindow.on('enter-full-screen', () => {
      this.updateLayoutBounds();
    });

    this.mainWindow.on('leave-full-screen', () => {
      this.updateLayoutBounds();
    });

    this.mainWindow.on('closed', () => {
      this.destroyAll();
    });

    return this.mainWindow;
  }

  /**
   * 跨平台解析应用图标路径（兼容 win32 / darwin / linux 及源码/安装包不同运行目录）
   */
  private resolveAppIcon(): string | undefined {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    const preferredName = isWin ? 'icon.ico' : isMac ? 'icon.icns' : 'icon.png';
    const fallbackNames = [preferredName, 'icon.png', 'icon.ico'];

    const searchDirs = [
      path.join(app.getAppPath(), 'build'),
      path.join(process.resourcesPath || '', 'build'),
      path.join(__dirname, '..', 'build'),
      path.join(__dirname, '..', '..', 'build'),
      path.join(process.cwd(), 'build'),
    ];

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fallbackNames) {
        const full = path.join(dir, name);
        if (fs.existsSync(full)) {
          return full;
        }
      }
    }
    return undefined;
  }

  /**
   * 获取主窗口实例
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /**
   * 创建首屏与网络加载 Loading 遮罩 View
   */
  private createLoadingView(): void {
    if (!this.mainWindow) return;

    const possiblePreloads = [
      path.join(__dirname, '..', 'preload-loading.js'),
      path.join(__dirname, 'preload-loading.js'),
    ];
    const loadingPreload = possiblePreloads.find((p) => fs.existsSync(p)) || possiblePreloads[0];

    this.loadingView = new BrowserView({
      webPreferences: {
        preload: loadingPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.mainWindow.addBrowserView(this.loadingView);

    const possiblePaths = [
      path.join(app.getAppPath(), 'electron', 'views', 'loading-screen.html'),
      path.join(__dirname, '..', 'views', 'loading-screen.html'),
      path.join(app.getAppPath(), 'dist-electron', 'views', 'loading-screen.html'),
      path.join(__dirname, 'views', 'loading-screen.html'),
    ];
    const loadingHtml = possiblePaths.find((p) => fs.existsSync(p)) || possiblePaths[0];
    console.log('[WindowManager] Loading Screen HTML from:', loadingHtml);
    this.loadingView.webContents.loadFile(loadingHtml);
    this.bindDevToolsShortcut(this.loadingView.webContents);

    this.isLoadingVisible = true;
  }

  /**
   * 显示 Loading 遮罩层
   */
  public showLoadingOverlay(message?: string): void {
    if (!this.mainWindow || !this.loadingView || this.loadingView.webContents.isDestroyed()) return;
    this.isLoadingVisible = true;
    const views = this.mainWindow.getBrowserViews();
    if (!views.includes(this.loadingView)) {
      this.mainWindow.addBrowserView(this.loadingView);
    }
    this.updateLayoutBounds();
    this.loadingView.webContents.send('loading:status', {
      state: 'loading',
      message,
      lang: this.currentLanguage,
    });
    this.updateTopViews();
  }

  /**
   * 隐藏 Loading 遮罩层 (平滑淡出)
   */
  public hideLoadingOverlay(): void {
    if (!this.isLoadingVisible || !this.loadingView || this.loadingView.webContents.isDestroyed()) return;
    this.isMainAppLoaded = true;
    this.loadingView.webContents.send('loading:status', {
      state: 'finishing',
    });
    // 延迟 300ms 待 CSS 淡出完毕后更新层级
    setTimeout(() => {
      this.isLoadingVisible = false;
      this.updateTopViews();
    }, 320);
  }

  /**
   * 显示 Loading 错误卡片
   */
  public showLoadingError(errorCode?: number, errorDescription?: string): void {
    if (!this.loadingView || this.loadingView.webContents.isDestroyed()) return;
    this.isLoadingVisible = true;
    this.updateTopViews();
    this.loadingView.webContents.send('loading:status', {
      state: 'error',
      errorCode,
      errorDescription,
      lang: this.currentLanguage,
    });
  }

  /**
   * 统一更新顶层视图堆叠顺序 (确保内容、Loading遮罩、TabBar 严丝合缝)
   */
  private updateTopViews(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const active = this.tabs.get(this.activeTabId);
    if (active && !active.view.webContents.isDestroyed()) {
      this.mainWindow.setTopBrowserView(active.view);
    }
    if (this.isLoadingVisible && this.activeTabId === 'main' && this.loadingView && !this.loadingView.webContents.isDestroyed()) {
      this.mainWindow.setTopBrowserView(this.loadingView);
    }
    if (this.tabBarView && !this.tabBarView.webContents.isDestroyed()) {
      this.mainWindow.setTopBrowserView(this.tabBarView);
    }
  }

  /**
   * 创建固定在窗口顶部的 TabBar View
   */
  private createTabBarView(): void {
    if (!this.mainWindow) return;

    const tabBarPreload = path.join(__dirname, '..', 'preload-tabbar.js');
    this.tabBarView = new BrowserView({
      webPreferences: {
        preload: tabBarPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.mainWindow.addBrowserView(this.tabBarView);

    const possiblePaths = [
      path.join(app.getAppPath(), 'electron', 'views', 'tab-bar.html'),
      path.join(__dirname, '..', 'views', 'tab-bar.html'),
      path.join(app.getAppPath(), 'dist-electron', 'views', 'tab-bar.html'),
      path.join(__dirname, 'views', 'tab-bar.html'),
    ];
    const tabBarHtml = possiblePaths.find((p) => fs.existsSync(p)) || possiblePaths[0];
    console.log('[WindowManager] Loading TabBar HTML from:', tabBarHtml);
    this.tabBarView.webContents.loadFile(tabBarHtml);
    this.bindDevToolsShortcut(this.tabBarView.webContents);
    systemLogger.subscribe(this.tabBarView.webContents);

    this.setupTabBarIpc();
  }

  /**
   * 注册 TabBar 的 IPC 控制指令
   */
  private setupTabBarIpc(): void {
    if (this.isTabBarIpcInitialized) return;
    this.isTabBarIpcInitialized = true;

    ipcMain.on('tabbar:ready', () => {
      this.notifyTabBarState();
    });

    ipcMain.on('tabbar:switch', (_event, tabId: string) => {
      this.switchTab(tabId);
    });

    ipcMain.on('tabbar:close', (_event, tabId: string) => {
      this.closeTab(tabId);
    });

    ipcMain.on('tabbar:open-platform', (_event, platformId: 'wechat' | 'xiaohongshu') => {
      this.openPlatformTab(platformId);
    });

    ipcMain.on('tabbar:go-back', () => {
      const active = this.tabs.get(this.activeTabId);
      if (!active) return;
      const nav = (active.view.webContents as any).navigationHistory;
      if (nav ? nav.canGoBack() : active.view.webContents.canGoBack()) {
        nav ? nav.goBack() : active.view.webContents.goBack();
      }
    });

    ipcMain.on('tabbar:go-forward', () => {
      const active = this.tabs.get(this.activeTabId);
      if (!active) return;
      const nav = (active.view.webContents as any).navigationHistory;
      if (nav ? nav.canGoForward() : active.view.webContents.canGoForward()) {
        nav ? nav.goForward() : active.view.webContents.goForward();
      }
    });

    ipcMain.on('tabbar:reload', () => {
      const active = this.tabs.get(this.activeTabId);
      if (active) {
        if (this.activeTabId === 'main') {
          this.showLoadingOverlay();
        }
        active.view.webContents.reload();
      }
    });

    ipcMain.on('tabbar:toggle-devtools', () => {
      this.toggleActiveDevTools();
    });

    ipcMain.on('tabbar:open-logs', () => {
      this.openLogsTab();
    });

    ipcMain.on('tabbar:open-render', () => {
      this.openRenderTab();
    });

    ipcMain.on('tabbar:open-about', () => {
      this.openAboutWindow();
    });

    ipcMain.on('tabbar:open-language-menu', (_event, coords?: { x?: number; y?: number }) => {
      this.showLanguageMenu(coords?.x, coords?.y);
    });

    ipcMain.on('tabbar:set-language', (_event, lang: string) => {
      this.setLanguage(lang);
    });

    ipcMain.on('loading:ready', () => {
      if (this.loadingView && !this.loadingView.webContents.isDestroyed()) {
        this.loadingView.webContents.send('loading:status', {
          state: this.isLoadingVisible ? 'loading' : (this.isMainAppLoaded ? 'idle' : 'loading'),
          lang: this.currentLanguage,
        });
      }
    });

    ipcMain.on('loading:retry', () => {
      const mainTab = this.tabs.get('main');
      if (mainTab && !mainTab.view.webContents.isDestroyed()) {
        this.showLoadingOverlay();
        mainTab.view.webContents.reload();
      }
    });
  }

  /**
   * 打开系统说明与关于软件模态窗口
   */
  openAboutWindow(): void {
    if (this.aboutWindow && !this.aboutWindow.isDestroyed()) {
      if (this.aboutWindow.isMinimized()) this.aboutWindow.restore();
      this.aboutWindow.show();
      this.aboutWindow.focus();
      return;
    }

    const candidates = [
      path.join(app.getAppPath(), 'electron', 'views', 'system-info.html'),
      path.join(__dirname, '..', 'views', 'system-info.html'),
      path.join(app.getAppPath(), 'dist-electron', 'views', 'system-info.html'),
      path.join(__dirname, 'views', 'system-info.html'),
    ];

    let aboutHtml = candidates.find((p) => fs.existsSync(p));
    if (!aboutHtml) {
      aboutHtml = path.join(__dirname, '..', 'views', 'system-info.html');
    }

    this.aboutWindow = new BrowserWindow({
      width: 500,
      height: 280,
      parent: this.mainWindow || undefined,
      modal: true,
      center: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      frame: false,
      hasShadow: true,
      autoHideMenuBar: true,
      title: `${getLocale(this.currentLanguage).menu.help.about || 'About'} - ${APP_CONFIG.appName}`,
      backgroundColor: '#0f172a',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });

    this.aboutWindow.loadFile(aboutHtml);

    this.aboutWindow.on('closed', () => {
      this.aboutWindow = null;
    });
  }

  /**
   * 在当前主窗口中打开或激活“系统运行日志”Tab 标签页
   * 直接新建 TAB 呈现，无需弹出新窗口
   */
  openLogsTab(activate: boolean = true): void {
    const tabId = 'syslogs';
    let tabData = this.tabs.get(tabId);

    // 若 Tab 不存在或已销毁，则新建 Tab
    if (!tabData || !tabData.view || !tabData.view.webContents || tabData.view.webContents.isDestroyed()) {
      if (tabData) {
        this.tabs.delete(tabId);
      }

      const candidates = [
        path.join(app.getAppPath(), 'electron', 'views', 'log-viewer.html'),
        path.join(__dirname, '..', 'views', 'log-viewer.html'),
        path.join(app.getAppPath(), 'dist-electron', 'views', 'log-viewer.html'),
        path.join(__dirname, 'views', 'log-viewer.html'),
      ];

      let logHtml = candidates.find((p) => fs.existsSync(p));
      if (!logHtml) {
        logHtml = path.join(__dirname, '..', 'views', 'log-viewer.html');
      }

      const view = new BrowserView({
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
        },
      });

      this.bindDevToolsShortcut(view.webContents);
      view.webContents.loadFile(logHtml);

      // 订阅全局系统日志实时广播
      systemLogger.subscribe(view.webContents);

      tabData = {
        id: tabId,
        title: getLocale(this.currentLanguage).menu.help.syslogs || '系统运行日志',
        closable: true,
        view,
      };

      this.tabs.set(tabId, tabData);
    } else {
      // 若 Tab 已存在且当前已处于此页面，平滑刷新以保证最新样式与功能生效
      try {
        tabData.view.webContents.reload();
      } catch (e) {
        // ignore
      }
    }

    if (activate) {
      this.switchTab(tabId);
    } else {
      this.updateLayoutBounds();
      this.notifyTabBarState();
    }
  }

  /**
   * 在当前主窗口中打开或激活“视频渲染”Tab 标签页
   * 直接新建 TAB 呈现，包含控制台与 pnpm run render 执行支持
   */
  openRenderTab(activate: boolean = true): void {
    const tabId = 'render';
    let tabData = this.tabs.get(tabId);

    // 若 Tab 不存在或已销毁，则新建 Tab
    if (!tabData || !tabData.view || !tabData.view.webContents || tabData.view.webContents.isDestroyed()) {
      if (tabData) {
        this.tabs.delete(tabId);
      }

      const candidates = [
        path.join(app.getAppPath(), 'electron', 'views', 'render-viewer.html'),
        path.join(__dirname, '..', 'views', 'render-viewer.html'),
        path.join(app.getAppPath(), 'dist-electron', 'views', 'render-viewer.html'),
        path.join(__dirname, 'views', 'render-viewer.html'),
      ];

      let renderHtml = candidates.find((p) => fs.existsSync(p));
      if (!renderHtml) {
        renderHtml = path.join(__dirname, '..', 'views', 'render-viewer.html');
      }

      const view = new BrowserView({
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
        },
      });

      this.bindDevToolsShortcut(view.webContents);
      view.webContents.loadFile(renderHtml);

      // 订阅渲染管理器实时广播
      renderManager.subscribe(view.webContents);

      tabData = {
        id: tabId,
        title: getLocale(this.currentLanguage).menu.help.render || '视频渲染',
        closable: true,
        view,
      };

      this.tabs.set(tabId, tabData);
    } else {
      try {
        tabData.view.webContents.reload();
      } catch (e) {
        // ignore
      }
    }

    if (activate) {
      this.switchTab(tabId);
    } else {
      this.updateLayoutBounds();
      this.notifyTabBarState();
    }
  }

  /**
   * 为指定 WebContents 绑定跨平台标准快捷键 (DevTools、关闭Tab、刷新当前Tab、Tab轮换)
   */
  private bindDevToolsShortcut(targetWebContents: WebContents): void {
    targetWebContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown') {
        const isF12 = input.key === 'F12';
        const isCtrlShiftI = (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
        const isMacDevTools = input.meta && input.alt && input.key.toLowerCase() === 'i'; // macOS 原生 Cmd+Option+I

        // 1. 切换开发者工具 (F12 / Ctrl+Shift+I / Cmd+Option+I)
        if (isF12 || isCtrlShiftI || isMacDevTools) {
          event.preventDefault();
          this.toggleActiveDevTools();
          return;
        }

        // 2. 关闭当前激活 Tab 标签页 (Cmd+W 或 Ctrl+W，主站不可关闭)
        const isCloseTab = (input.control || input.meta) && !input.shift && !input.alt && input.key.toLowerCase() === 'w';
        if (isCloseTab && this.activeTabId !== 'main') {
          event.preventDefault();
          this.closeTab(this.activeTabId);
          return;
        }

        // 3. 刷新当前激活 Tab 标签页 (F5 或 Cmd+R / Ctrl+R)
        const isRefreshKey = input.key === 'F5' || ((input.control || input.meta) && !input.shift && !input.alt && input.key.toLowerCase() === 'r');
        if (isRefreshKey) {
          event.preventDefault();
          const active = this.tabs.get(this.activeTabId);
          if (active && !active.view.webContents.isDestroyed()) {
            active.view.webContents.reload();
          }
          return;
        }

        // 4. 在已打开的 Tab 间顺序轮换 (Ctrl+Tab)
        if (input.control && input.key === 'Tab') {
          event.preventDefault();
          const tabKeys = Array.from(this.tabs.keys());
          if (tabKeys.length > 1) {
            const curIdx = tabKeys.indexOf(this.activeTabId);
            const nextIdx = input.shift
              ? (curIdx - 1 + tabKeys.length) % tabKeys.length
              : (curIdx + 1) % tabKeys.length;
            this.switchTab(tabKeys[nextIdx]);
          }
          return;
        }
      }
    });
  }

  /**
   * 切换当前激活 Tab 的开发者调试工具
   */
  toggleActiveDevTools(): void {
    const active = this.tabs.get(this.activeTabId);
    if (active && !active.view.webContents.isDestroyed()) {
      if (active.view.webContents.isDevToolsOpened()) {
        active.view.webContents.closeDevTools();
      } else {
        active.view.webContents.openDevTools({ mode: 'detach' });
      }
    } else if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.webContents.isDevToolsOpened()) {
        this.mainWindow.webContents.closeDevTools();
      } else {
        this.mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  }

  /**
   * 向 TabBar 发送最新状态更新
   */
  /**
   * 从主站当前 URL 中提取语言代码 (如 zh, en, ja, ko, vi, th, bn, id, ur)
   */
  private extractMainAppLanguage(): string {
    const mainTab = this.tabs.get('main');
    if (!mainTab || !mainTab.view || !mainTab.view.webContents || mainTab.view.webContents.isDestroyed()) return 'zh';
    const currentUrl = mainTab.view.webContents.getURL() || '';
    try {
      if (currentUrl) {
        const u = new URL(currentUrl);
        const match = u.pathname.match(/^\/([a-zA-Z]{2})/);
        if (match) {
          const l = match[1].toLowerCase();
          this.currentLanguage = l;
          return l;
        }
      }
    } catch { }
    return this.currentLanguage || 'zh';
  }

  /**
   * 向 TabBar 发送最新状态更新
   */
  private notifyTabBarState(): void {
    if (!this.tabBarView || this.tabBarView.webContents.isDestroyed()) return;

    const tabsList = Array.from(this.tabs.values()).map((t) => ({
      id: t.id,
      title: t.title,
      closable: t.closable,
    }));

    const currentLang = this.currentLanguage || this.extractMainAppLanguage();

    this.tabBarView.webContents.send('tabbar:state-update', {
      tabs: tabsList,
      activeTabId: this.activeTabId,
      lang: currentLang,
    });
  }

  /**
   * 创建主站 View
   */
  private createMainAppTab(preloadPath: string): void {
    if (!this.mainWindow) return;

    const mainView = new BrowserView({
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true, // 必须开启标准安全上下文，确保通过 Google OAuth 等安全沙箱校验
        backgroundThrottling: false,
      },
    });

    mainView.webContents.setUserAgent(APP_CONFIG.userAgent);
    this.injectStealth(mainView.webContents);
    this.bindDevToolsShortcut(mainView.webContents);

    // 主站 window.open 处理：
    // Google OAuth 及第三方认证（Facebook, Line, 微信等）在独立认证弹窗中打开，与主站共享 Session
    const OAUTH_URL_PREFIXES = [
      'https://accounts.google.com',
      'https://myaccount.google.com',
      'https://oauth2.googleapis.com',
      'https://signin.google.com',
      'https://apis.google.com',
      'https://www.facebook.com',
      'https://access.line.me',
      'https://open.weixin.qq.com',
    ];
    mainView.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (!url) return { action: 'deny' };
        // Google OAuth 及第三方认证：在独立认证弹窗中打开，与主站共享 Session，彻底杜绝系统浏览器割裂与多开问题
        const isOAuthAuth = OAUTH_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
        if (isOAuthAuth) {
          console.log('[WindowManager] 捕获到 OAuth 认证窗口请求(window.open)，开启独立认证弹窗:', url);
          this.openOAuthWindow(url);
          return { action: 'deny' }; // 阻止默认的不可控弹出
        }
        // 其他 HTTP 链接在当前 View 内导航
        if (url.startsWith('http://') || url.startsWith('https://')) {
          mainView.webContents.loadURL(url).catch((e) => {
            console.warn('[WindowManager] 主站 window.open 重定向失败:', e?.message || e);
          });
        }
      } catch (e: any) {
        console.warn('[WindowManager] mainView setWindowOpenHandler 异常:', e?.message || e);
      }
      return { action: 'deny' };
    });

    // 拦截主站 BrowserView 自身顶层导航至 OAuth 登录页的情况（如直接点击第三方登录按钮触发 top-level 跳转）
    // 阻止主站视图脱离，转为打开独立认证弹窗并在授权完成后自动同步 Token 刷新主站
    mainView.webContents.on('will-navigate', (event, url) => {
      try {
        const isOAuthAuth = OAUTH_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
        if (isOAuthAuth) {
          event.preventDefault();
          console.log('[WindowManager] 主站顶层导航至 OAuth 认证已拦截，转至独立认证弹窗:', url);
          this.openOAuthWindow(url);
        }
      } catch { }
    });

    // 拦截服务端 302 重定向到 OAuth 认证页的情况
    mainView.webContents.on('will-redirect', (event, url) => {
      try {
        const isOAuthAuth = OAUTH_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
        if (isOAuthAuth) {
          event.preventDefault();
          console.log('[WindowManager] 主站服务端重定向至 OAuth 认证已拦截，转至独立认证弹窗:', url);
          this.openOAuthWindow(url);
        }
      } catch { }
    });

    // 监听主站页面内路由导航，实时向顶部 TabBar 同步多语言环境
    const notifyLanguageChange = (url: string) => {
      try {
        const u = new URL(url);
        const match = u.pathname.match(/^\/([a-zA-Z]{2})/);
        const lang = match ? match[1].toLowerCase() : 'zh';
        if (SUPPORTED_LANGUAGES.some((item) => item.code === lang)) {
          this.currentLanguage = lang;
          if (this.tabBarView && !this.tabBarView.webContents.isDestroyed()) {
            this.tabBarView.webContents.send('tabbar:language-change', lang);
          }
          if (this.loadingView && !this.loadingView.webContents.isDestroyed()) {
            this.loadingView.webContents.send('loading:language-change', lang);
          }
        }
      } catch { }
    };

    mainView.webContents.on('did-navigate', (_e, url) => {
      notifyLanguageChange(url);
      setTimeout(() => this.getMainAuthToken().catch(() => {}), 1500);
    });
    mainView.webContents.on('did-navigate-in-page', (_e, url) => {
      notifyLanguageChange(url);
      setTimeout(() => this.getMainAuthToken().catch(() => {}), 1000);
    });
    mainView.webContents.on('did-start-loading', () => {
      if (!this.isMainAppLoaded) {
        this.showLoadingOverlay();
      }
    });
    mainView.webContents.on('dom-ready', () => {
      this.hideLoadingOverlay();
      setTimeout(() => this.getMainAuthToken().catch(() => {}), 1000);
    });
    mainView.webContents.on('did-finish-load', () => {
      notifyLanguageChange(mainView.webContents.getURL());
      this.hideLoadingOverlay();
      setTimeout(() => this.getMainAuthToken().catch(() => {}), 1500);
    });
    mainView.webContents.on('did-fail-load', (_e, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        console.warn(`[WindowManager] 主站加载异常 (${errorCode}): ${errorDescription}`);
        this.showLoadingError(errorCode, errorDescription);
      }
    });

    let startUrl = process.env.ELECTRON_START_URL || APP_CONFIG.siteUrl || APP_CONFIG.productionUrl;

    if (!startUrl) {
      console.error('[WindowManager] 未配置有效站点地址 (NEXT_PUBLIC_SITE_ORIGIN 未配置)');
      this.showLoadingError(-1, '未配置有效站点地址');
    } else {
      if (this.currentLanguage && this.currentLanguage !== 'zh') {
        try {
          const u = new URL(startUrl);
          const match = u.pathname.match(/^\/([a-zA-Z]{2})/);
          if (!match) {
            u.pathname = `/${this.currentLanguage}${u.pathname}`;
            startUrl = u.toString();
          }
        } catch { }
      }
      this.showLoadingOverlay();
      mainView.webContents.loadURL(startUrl).catch((err) => {
        console.error('[WindowManager] 站点加载失败:', err?.message || err);
        this.showLoadingError(-2, err?.message || '站点加载失败');
      });
    }

    this.tabs.set('main', {
      id: 'main',
      title: 'ShortVideo 主站',
      closable: false,
      view: mainView,
    });

    this.mainWindow.addBrowserView(mainView);
    this.activeTabId = 'main';
    this.updateLayoutBounds();
    this.updateTopViews();
    this.notifyTabBarState();
  }

  /**
   * 在当前主窗口中打开或激活平台 Tab
   */
  openPlatformTab(platformId: 'wechat' | 'xiaohongshu', targetUrl?: string): PlatformTabAdapter {
    let tabData = this.tabs.get(platformId);

    // 若 Tab 不存在或已销毁，则重新创建
    if (!tabData || !tabData.view || !tabData.view.webContents || tabData.view.webContents.isDestroyed()) {
      if (tabData) {
        this.tabs.delete(platformId);
      }
      const platformConfig = APP_CONFIG.platforms[platformId];
      const customSession = session.fromPartition(`persist:${platformId}`, { cache: true });
      customSession.setUserAgent(APP_CONFIG.userAgent);
      this.configureSessionInterceptors(customSession, `persist:${platformId}`);

      const possibleStealthPreloads = [
        path.join(__dirname, '..', 'preload-stealth.js'),
        path.join(__dirname, 'preload-stealth.js'),
      ];
      const stealthPreloadPath = possibleStealthPreloads.find((p) => fs.existsSync(p)) || possibleStealthPreloads[0];

      const view = new BrowserView({
        webPreferences: {
          preload: stealthPreloadPath,
          session: customSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: true, // 保持标准安全上下文，确保小红书/微信安全验证码与 iframe 正常握手
          backgroundThrottling: false, // 彻底禁用后台休眠节流，切走后依然保持满速渲染、定时器与 CDP 自动化
        },
      });

      this.injectStealth(view.webContents);
      this.bindDevToolsShortcut(view.webContents);

      // 拦截页面内部所有 window.open / target="_blank"
      // 杜绝脱离应用弹出独立窗口，确保所有发布/跳转都在当前 Tab 视图内平滑加载
      view.webContents.setWindowOpenHandler(({ url }) => {
        try {
          if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            view.webContents.loadURL(url).catch((e) => {
              console.warn(`[WindowManager] 窗口内重定向失败 (${platformId}):`, e.message);
            });
          }
        } catch (e: any) {
          console.warn(`[WindowManager] setWindowOpenHandler 异常 (${platformId}):`, e.message);
        }
        return { action: 'deny' };
      });

      const loadUrl = targetUrl || platformConfig.homeUrl;
      view.webContents.loadURL(loadUrl).catch((e) => {
        console.warn(`[WindowManager] 加载平台初始 URL 异常 (${platformId}):`, e.message);
      });

      const loc = getLocale(this.currentLanguage);
      const platTitle = platformId === 'wechat' ? loc.platforms.wechat : loc.platforms.xiaohongshu;
      tabData = {
        id: platformId,
        title: platTitle || platformConfig.name,
        closable: true,
        view,
      };

      this.tabs.set(platformId, tabData);
      sessionKeeper.register(platformId, view.webContents);

      // 监听 Tab 销毁，确保哪怕被底层意外销毁也能触发中止通知
      view.webContents.once('destroyed', () => {
        for (const listener of this.tabCloseListeners) {
          try {
            listener(platformId);
          } catch { }
        }
      });
    } else if (targetUrl && !tabData.view.webContents.isDestroyed()) {
      const curUrl = tabData.view.webContents.getURL() || '';
      // 仅在当前处于空白页或明显异常时才执行 loadURL，避免已登录或已有状态被意外重置
      if (!curUrl || curUrl === 'about:blank') {
        tabData.view.webContents.loadURL(targetUrl).catch((e) => {
          console.warn(`[WindowManager] 导航至目标 URL 异常 (${platformId}):`, e.message);
        });
      }
    }

    this.switchTab(platformId);

    return this.getPlatformTabAdapter(platformId);
  }

  /**
   * 切换当前激活的 Tab 视图（采用分层堆叠与 setTopBrowserView，支持后台无缝继续执行发布任务）
   */
  switchTab(tabId: string): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const target = this.tabs.get(tabId);
    if (!target || !target.view || target.view.webContents.isDestroyed()) return;

    this.activeTabId = tabId;
    const currentViews = this.mainWindow.getBrowserViews();

    // 确保目标 Tab 挂载在主窗口中
    if (!currentViews.includes(target.view)) {
      this.mainWindow.addBrowserView(target.view);
    }

    // 刷新各视图的物理布局尺寸（保证后台 Tab 同样具备真实视口尺寸供 CDP 自动化计算坐标）
    this.updateLayoutBounds();

    // 统一按最新状态调整顶层视图顺序
    this.updateTopViews();

    try {
      target.view.webContents.focus();
    } catch { }

    // 动态同步更新系统原生窗口标题（包含当前激活功能模块名称）
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const displayTitle = this.getTabDisplayTitle(target.id, this.currentLanguage);
      target.title = displayTitle;
      const windowTitle = displayTitle && target.id !== 'main'
        ? `${displayTitle} - ${APP_CONFIG.appName}`
        : APP_CONFIG.appName;
      this.mainWindow.setTitle(windowTitle);
    }

    this.notifyTabBarState();
  }

  /**
   * 关闭指定 Tab
   */
  closeTab(tabId: string): void {
    if (tabId === 'main') return; // 主站不可关闭

    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // 先立即触发 Tab 关闭事件监听（强行中止对应的发布任务）
    for (const listener of this.tabCloseListeners) {
      try {
        listener(tabId);
      } catch (err: any) {
        console.error(`[WindowManager] 执行 onTabClose 监听异常 (${tabId}):`, err.message);
      }
    }

    if (this.mainWindow) {
      try {
        this.mainWindow.removeBrowserView(tab.view);
      } catch { }
    }

    try {
      (tab.view.webContents as any).destroy();
    } catch { }

    this.tabs.delete(tabId);
    sessionKeeper.unregister(tabId);

    // 若关闭的是当前 Tab，平滑切回主站
    if (this.activeTabId === tabId) {
      this.switchTab('main');
    } else {
      this.notifyTabBarState();
    }
  }

  /**
   * 刷新窗口内部各 View 的尺寸约束（所有挂载视图同步保持真实渲染尺寸，保障后台 CDP 精准交互）
   */
  private updateLayoutBounds(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const { width, height } = this.mainWindow.getContentBounds();
    const currentBarHeight = TAB_BAR_DOUBLE_HEIGHT;

    if (this.tabBarView && !this.tabBarView.webContents.isDestroyed()) {
      this.tabBarView.setBounds({
        x: 0,
        y: 0,
        width,
        height: currentBarHeight,
      });
    }

    const viewHeight = Math.max(0, height - currentBarHeight);

    // 同步更新 Loading 遮罩尺寸
    if (this.loadingView && !this.loadingView.webContents.isDestroyed()) {
      this.loadingView.setBounds({
        x: 0,
        y: currentBarHeight,
        width,
        height: viewHeight,
      });
    }

    // 为所有已挂载的 Tab 视图同步保持视口尺寸，确保即使用户切走，后台自动化脚本的坐标获取与物理点击不受任何影响
    for (const [, tab] of this.tabs) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        tab.view.setBounds({
          x: 0,
          y: currentBarHeight,
          width,
          height: viewHeight,
        });
      }
    }
  }

  /**
   * 获取供自动化发布脚本操作的平台适配器（动态自愈，避免闭包捕获导致 undefined 或 destroyed 报错）
   */
  getPlatformTabAdapter(platformId: 'wechat' | 'xiaohongshu'): PlatformTabAdapter {
    const isClosed = (): boolean => {
      const tab = this.tabs.get(platformId);
      return !tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed();
    };

    const ensureTab = (): TabData => {
      let tab = this.tabs.get(platformId);
      if (!tab || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) {
        throw new Error(`平台标签页【${platformId}】已被关闭，自动化操作终止`);
      }
      return tab;
    };

    return {
      isClosed,
      get webContents(): WebContents {
        const tab = ensureTab();
        return tab.view.webContents;
      },
      loadURL: async (url: string) => {
        if (isClosed()) return;
        const tab = ensureTab();
        const wc = tab.view.webContents;
        if (wc && !wc.isDestroyed()) {
          const currentUrl = wc.getURL();
          if (currentUrl === url) return;
          try {
            await wc.loadURL(url);
          } catch (err: any) {
            if (!err?.message?.includes('ERR_ABORTED')) {
              console.warn(`[WindowManager] 导航至 ${url} 异常:`, err.message);
            }
          }
        }
      },
      show: () => {
        if (!isClosed()) {
          this.switchTab(platformId);
        }
      },
      focus: () => {
        if (!isClosed()) {
          this.switchTab(platformId);
          const tab = this.tabs.get(platformId);
          if (tab?.view?.webContents && !tab.view.webContents.isDestroyed()) {
            tab.view.webContents.focus();
          }
        }
      },
      getCdpClient: async () => {
        if (isClosed()) {
          throw new Error(`平台标签页【${platformId}】已关闭，无法建立 CDP 连接`);
        }
        const tab = ensureTab();
        return cdpBridge.getClientForPlatform(platformId, tab.view.webContents);
      },
    };
  }

  /**
   * 注入反反爬防检测脚本（在根节点解析前、dom-ready、did-finish-load 等生命周期强注入）
   * Google 账号相关域名对原生 API 完整性有严格校验，禁止向其注入任何 stealth 脚本
   */
  public injectStealth(webContents: WebContents): void {
    if (!webContents || webContents.isDestroyed()) return;

    try {
      webContents.setMaxListeners(Math.max(webContents.getMaxListeners(), 100));
    } catch { }

    if (this.stealthInjectedContents.has(webContents)) {
      return;
    }
    this.stealthInjectedContents.add(webContents);

    const GOOGLE_OAUTH_HOSTS = [
      'accounts.google.com',
      'myaccount.google.com',
      'oauth2.googleapis.com',
      'signin.google.com',
    ];

    const isGoogleOAuthUrl = (url: string): boolean => {
      try {
        const host = new URL(url).hostname;
        return GOOGLE_OAUTH_HOSTS.some((h) => host === h || host.endsWith('.' + h));
      } catch {
        return false;
      }
    };

    const safeInject = () => {
      try {
        if (webContents.isDestroyed()) return;
        const url = webContents.getURL() || '';
        if (isGoogleOAuthUrl(url)) return; // 跳过 Google 账号页面，保持其原生 API 完整性
        webContents.executeJavaScript(STEALTH_SCRIPT).catch(() => { });
      } catch { }
    };

    // 最早时机：HTML 根节点刚创建、外部脚本尚未解析前注入，抢占原型链
    webContents.on('did-create-document-element' as any, safeInject);
    webContents.on('dom-ready', safeInject);
    webContents.on('did-finish-load', safeInject);
  }

  /**
   * 向所有标签页视图及主窗口广播 IPC 消息
   */
  broadcast(channel: string, ...args: any[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try { this.mainWindow.webContents.send(channel, ...args); } catch { }
    }
    if (this.tabBarView && !this.tabBarView.webContents.isDestroyed()) {
      try { this.tabBarView.webContents.send(channel, ...args); } catch { }
    }
    if (this.aboutWindow && !this.aboutWindow.isDestroyed()) {
      try { this.aboutWindow.webContents.send(channel, ...args); } catch { }
    }
    for (const [, tab] of this.tabs) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        try { tab.view.webContents.send(channel, ...args); } catch { }
      }
    }
  }

  /**
   * 集中配置 Session 网络拦截器（严格防重，同一 Partition 仅初始化一次，杜绝 webRequest 回调内存泄漏）
   */
  private configureSessionInterceptors(sess: Electron.Session, partitionKey: string): void {
    if (!sess) return;
    if (this.configuredSessions.has(partitionKey)) return;
    this.configuredSessions.add(partitionKey);

    this.setupCorsBypass(sess);
    this.setupStealthHeaders(sess);
  }

  /**
   * 配置 session 放行自有资源与多媒体素材跨域限制 (CORS Bypass)
   * 针对 download.shortvideo.ca 与 shortvideo.ca 注入标准 CORS 响应头
   */
  private setupCorsBypass(sess: Electron.Session): void {
    if (!sess) return;
    try {
      const filter = {
        urls: [
          '*://*.shortvideo.ca/*',
          '*://download.shortvideo.ca/*',
        ],
      };

      sess.webRequest.onHeadersReceived(filter, (details, callback) => {
        const responseHeaders = { ...(details.responseHeaders || {}) };

        // 统一清理可能冲突的同名响应头
        delete responseHeaders['access-control-allow-origin'];
        delete responseHeaders['Access-Control-Allow-Origin'];
        delete responseHeaders['access-control-allow-methods'];
        delete responseHeaders['Access-Control-Allow-Methods'];
        delete responseHeaders['access-control-allow-headers'];
        delete responseHeaders['Access-Control-Allow-Headers'];
        delete responseHeaders['access-control-allow-credentials'];
        delete responseHeaders['Access-Control-Allow-Credentials'];

        // 注入完整跨域授权：
        // 规范要求 Allow-Credentials:true 时，Allow-Origin 必须为具体 origin 而非通配符 *
        // 从请求 Origin 头动态取值，保证凭证携带场景下的 CORS 握手合规
        const reqHeaders = (details as any).requestHeaders as Record<string, string> | undefined;
        const requestOrigin = reqHeaders?.['Origin'] || reqHeaders?.['origin'] || '';
        const allowedOriginPattern = /^https?:\/\/([a-z0-9-]+\.)?shortvideo\.ca(:\d+)?$/i;
        const resolvedOrigin = (requestOrigin && allowedOriginPattern.test(requestOrigin))
          ? requestOrigin
          : (process.env.NEXT_PUBLIC_APP_SITE_URL || process.env.NEXT_PUBLIC_SITE_ORIGIN || 'https://app.shortvideo.ca');

        responseHeaders['Access-Control-Allow-Origin'] = [resolvedOrigin];
        responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, POST, PUT, DELETE, OPTIONS'];
        responseHeaders['Access-Control-Allow-Headers'] = ['*'];
        responseHeaders['Access-Control-Allow-Credentials'] = ['true'];

        callback({ responseHeaders });
      });
    } catch (e: any) {
      console.warn('[WindowManager] 设置 CORS 过滤器异常:', e?.message || e);
    }
  }

  /**
   * 清洗与伪装 HTTP 请求头 (Client Hints)，彻底抹除 Electron 特征
   * 确保小红书/微信服务端的反爬网关识别为纯正 Windows Chrome 128
   */
  private setupStealthHeaders(sess: Electron.Session): void {
    if (!sess) return;
    try {
      // 仅拦截外部不可信网页前端对本地 Chromium 调试端口的嗅探请求，防止反爬探测到 Debugger 开放
      // 注意：Chromium webRequest URL pattern 中 * scheme 不支持端口号，必须明确使用 http://
      const cdpPort = cdpBridge.getPort();
      if (cdpPort > 0) {
        sess.webRequest.onBeforeRequest(
          { urls: [`http://127.0.0.1:${cdpPort}/*`, `http://localhost:${cdpPort}/*`] },
          (details, callback) => {
            const initiator = (details as any).initiator || details.referrer || '';
            if (
              initiator &&
              (initiator.startsWith('http://') || initiator.startsWith('https://')) &&
              !initiator.includes('localhost') &&
              !initiator.includes('127.0.0.1')
            ) {
              return callback({ cancel: true });
            }
            callback({ cancel: false });
          }
        );
      }
      sess.webRequest.onBeforeSendHeaders((details, callback) => {
        const req = { ...(details.requestHeaders || {}) };

        // 1. 彻底清空所有大小写变体的原生 Sec-CH-UA 请求头，杜绝任何包含 "Electron" 签名的头部残留
        for (const key of Object.keys(req)) {
          const lowerKey = key.toLowerCase();
          if (
            lowerKey.startsWith('sec-ch-ua') ||
            lowerKey === 'x-forwarded-for' ||
            lowerKey === 'via' ||
            lowerKey === 'x-electron' ||
            lowerKey === 'x-devtools-emulate-network-conditions-client-id'
          ) {
            delete req[key];
          }
        }

        // 2. 统一注入纯净的原生 Client Hints（平台自适应）
        req['User-Agent'] = APP_CONFIG.userAgent;
        req['user-agent'] = APP_CONFIG.userAgent;
        req['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
        req['sec-ch-ua-mobile'] = '?0';
        req['sec-ch-ua-full-version'] = '"131.0.6778.205"';
        req['sec-ch-ua-full-version-list'] = '"Google Chrome";v="131.0.6778.205", "Chromium";v="131.0.6778.205", "Not_A Brand";v="24.0.0.0"';
        const isArm = process.arch === 'arm64' || process.arch === 'arm';
        const archName = isArm ? 'arm' : 'x86';

        if (process.platform === 'darwin') {
          req['sec-ch-ua-platform'] = '"macOS"';
          req['sec-ch-ua-arch'] = `"${archName}"`;
          req['sec-ch-ua-bitness'] = '"64"';
          req['sec-ch-ua-wow64'] = '?0';
          req['sec-ch-ua-platform-version'] = '"14.0.0"';
        } else if (process.platform === 'linux') {
          req['sec-ch-ua-platform'] = '"Linux"';
          req['sec-ch-ua-arch'] = `"${archName}"`;
          req['sec-ch-ua-bitness'] = '"64"';
          req['sec-ch-ua-wow64'] = '?0';
          req['sec-ch-ua-platform-version'] = '"6.1.0"';
        } else {
          req['sec-ch-ua-platform'] = '"Windows"';
          req['sec-ch-ua-arch'] = '"x86"';
          req['sec-ch-ua-bitness'] = '"64"';
          req['sec-ch-ua-wow64'] = '?0';
          req['sec-ch-ua-platform-version'] = '"15.0.0"';
        }

        // 3. 语言头确保标准
        if (!req['Accept-Language'] && !req['accept-language']) {
          req['Accept-Language'] = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';
        }

        callback({ requestHeaders: req });
      });
    } catch (e: any) {
      console.warn('[WindowManager] 设置请求头伪装异常:', e?.message || e);
    }
  }

  /**
   * 应用通过外部 OAuth 流程（系统浏览器或弹窗）获取到的 Token 与 User 数据
   */
  public async applyAuthToken(token: string, user: any): Promise<void> {
    if (!token) return;
    try {
      console.log('[WindowManager] 收到来自 OAuth 流程的凭证，开始同步至主站 LocalStorage...');

      // 1. 若当前存在认证弹窗，及时关闭
      if (this.oauthWindow && !this.oauthWindow.isDestroyed()) {
        try {
          this.oauthWindow.close();
        } catch { }
        this.oauthWindow = null;
      }

      // 2. 唤醒并激活主窗口（强制穿透 Windows 焦点防抢占保护）
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.setAlwaysOnTop(true);
        this.mainWindow.show();
        this.mainWindow.focus();
        this.mainWindow.setAlwaysOnTop(false);
      }

      // 3. 向主站注入 LocalStorage 凭证并刷新
      const mainTab = this.tabs.get('main');
      if (mainTab?.view && !mainTab.view.webContents.isDestroyed()) {
        await mainTab.view.webContents.executeJavaScript(`
          (function() {
            try {
              localStorage.setItem('TokenKeyName', ${JSON.stringify(token)});
              if (${JSON.stringify(user)}) {
                localStorage.setItem('userData', ${JSON.stringify(typeof user === 'string' ? user : JSON.stringify(user))});
              }
              window.dispatchEvent(new Event('storage'));
            } catch(e) {}
          })();
        `);

        const curMainUrl = mainTab.view.webContents.getURL() || '';
        const siteOrigin = APP_CONFIG.siteUrl || APP_CONFIG.productionUrl || 'https://app.shortvideo.ca';
        let targetDestination = siteOrigin;
        if (curMainUrl && curMainUrl.includes('/login')) {
          // 精确保留用户原本的语言路径 (如 /zh/login -> /zh/)
          targetDestination = curMainUrl.replace(/\/login.*$/, '/') || siteOrigin;
        }

        console.log('[WindowManager] 凭证已注入，正在引导主站进入已登录页:', targetDestination);
        if (curMainUrl === targetDestination) {
          mainTab.view.webContents.reload();
        } else {
          mainTab.view.webContents.loadURL(targetDestination).catch(() => {
            mainTab.view.webContents.reload();
          });
        }

        // 4. 用户在外部浏览器完成授权后，自动唤起并聚焦桌面客户端主窗口（利用临时 AlwaysOnTop 突破 Windows 焦点锁定）
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          try {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore();
            this.mainWindow.setAlwaysOnTop(true);
            this.mainWindow.show();
            this.mainWindow.focus();
            this.mainWindow.setAlwaysOnTop(false);
          } catch { }
        }
      }
    } catch (e: any) {
      console.warn('[WindowManager] applyAuthToken 异常:', e?.message || e);
    }
  }

  /**
  /**
   * 解密并提取合法的标准 JWT Token (支持明文 JWT 与 AES-256-CBC 密文两种形态)
   */
  private decryptTokenString(rawToken: string): string {
    if (!rawToken || typeof rawToken !== 'string') return '';
    const trimmed = rawToken.trim();
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) {
      return trimmed;
    }
    try {
      const keyHex = process.env.NEXT_PUBLIC_AESKEY || '68656c6c6f20776f726c64203132333435363738';
      const ivHex = process.env.NEXT_PUBLIC_AESIV || '31323334353637383930313233343536';
      const key = Buffer.from(keyHex.padEnd(64, '0'), 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key as any, iv as any);
      let decrypted = decipher.update(trimmed, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      if (decrypted) {
        try {
          const parsed = JSON.parse(decrypted);
          if (typeof parsed === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.trim())) {
            return parsed.trim();
          }
          if (parsed && typeof parsed.token === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(parsed.token.trim())) {
            return parsed.token.trim();
          }
          if (typeof parsed === 'string') return parsed.trim();
        } catch {
          return decrypted.trim();
        }
      }
    } catch (_) {}
    return trimmed;
  }

  /**
   * 获取当前桌面客户端主站已登录用户的 Auth Token (JWT)
   */
  public async getMainAuthToken(): Promise<string> {
    const sessionFile = path.join(app.getPath('userData'), 'user_session.json');

    // 1. 尝试从活动的主站点页面 WebContents 中提取
    const mainTab = this.tabs.get('main');
    if (mainTab?.view && !mainTab.view.webContents.isDestroyed()) {
      try {
        const rawToken = await mainTab.view.webContents.executeJavaScript(`
          (function() {
            try {
              const candidateKeys = ['TokenKeyName', 'token', 'auth_token', 'accessToken', 'jwt'];
              for (const k of candidateKeys) {
                const v = localStorage.getItem(k);
                if (v && v.trim()) return v.trim();
              }
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && /token|auth/i.test(k)) {
                  const v = localStorage.getItem(k);
                  if (v && v.trim()) return v.trim();
                }
              }
              const m = document.cookie.match(/(?:^|;\\s*)(?:token|TokenKeyName|auth_token)=([^;]+)/i);
              if (m && m[1]) return decodeURIComponent(m[1]).trim();
              return '';
            } catch(e) {
              return '';
            }
          })();
        `);
        if (rawToken && typeof rawToken === 'string' && rawToken.trim()) {
          const decrypted = this.decryptTokenString(rawToken);
          if (decrypted) {
            try {
              fs.writeFileSync(sessionFile, JSON.stringify({ token: decrypted, updatedAt: Date.now() }, null, 2), 'utf-8');
            } catch (_) {}
            return decrypted;
          }
        }
      } catch (_) { }
    }

    // 2. 尝试从 Electron 会话 Cookie 体系提取
    try {
      const siteUrl = APP_CONFIG.siteUrl || APP_CONFIG.productionUrl || 'https://app.shortvideo.ca';
      const cookies = await session.defaultSession.cookies.get({ url: siteUrl });
      for (const c of cookies) {
        if ((c.name === 'token' || c.name === 'TokenKeyName' || c.name === 'auth_token') && c.value) {
          const decrypted = this.decryptTokenString(c.value);
          if (decrypted) {
            try {
              fs.writeFileSync(sessionFile, JSON.stringify({ token: decrypted, updatedAt: Date.now() }, null, 2), 'utf-8');
            } catch (_) {}
            return decrypted;
          }
        }
      }
    } catch (_) { }

    // 3. 兜底回退：尝试读取本地持久化用户会话文件
    try {
      if (fs.existsSync(sessionFile)) {
        const raw = fs.readFileSync(sessionFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed?.token && typeof parsed.token === 'string') {
          return parsed.token.trim();
        }
      }
    } catch (_) {}

    return '';
  }

  /**
   * 打开独立专用的 OAuth 认证（Google 严格遵循官方 RFC 8252 标准调用系统默认浏览器 + PKCE 回跳，其他平台使用内嵌弹窗）
   */
  public openOAuthWindow(oauthUrl: string): void {
    if (!oauthUrl) return;

    const isGoogleAuth = oauthUrl.includes('accounts.google.com') || oauthUrl.includes('google');

    // Google OAuth：Google 官方全面禁止嵌入式 WebView
    // 遵循官方安全规范：系统浏览器授权 + 线上已登记的 Callback 桥接回传至客户端本地 Loopback HTTP 服务
    if (isGoogleAuth) {
      try {
        oauthBridge.ensureHttpServer();
        const port = oauthBridge.getPort();

        let targetUrl = oauthUrl;
        try {
          const parsed = new URL(oauthUrl);
          const siteUrl = APP_CONFIG.siteUrl || APP_CONFIG.productionUrl || 'https://app.shortvideo.ca';
          const validRedirectUri = `${siteUrl.replace(/\/$/, '')}/oauth/callback`;

          // GCP 控制台已授权 http://127.0.0.1:39281/callback，直接回调至本地监听的 Loopback 服务
          const localRedirectUri = `http://127.0.0.1:${port}/callback`;
          parsed.searchParams.set('redirect_uri', localRedirectUri);

          // 在 state 中追加 __desktop__ 标记与端口号
          const currentState = parsed.searchParams.get('state') || '';
          let finalState = currentState;
          if (!currentState.includes('__desktop__')) {
            const baseState = currentState || 'zh_google';
            finalState = `${baseState}__desktop__${port}`;
            parsed.searchParams.set('state', finalState);
          }
          oauthBridge.registerPendingState(finalState);

          targetUrl = parsed.toString();
        } catch { }

        console.log('[WindowManager] 启动系统默认浏览器进行 Google 官方认证 (直接回调本地 127.0.0.1):', targetUrl);
        shell.openExternal(targetUrl).catch((err) => {
          console.warn('[WindowManager] 打开系统浏览器失败:', err?.message || err);
        });
        return;
      } catch (e: any) {
        console.warn('[WindowManager] 构建 Google 认证链接失败:', e?.message || e);
      }
    }

    // 1. 如果已有认证弹窗正在进行，直接置顶激活并加载，防止多开窗口
    if (this.oauthWindow && !this.oauthWindow.isDestroyed()) {
      try {
        if (this.oauthWindow.isMinimized()) this.oauthWindow.restore();
        this.oauthWindow.focus();
        this.oauthWindow.loadURL(oauthUrl).catch(() => { });
      } catch { }
      return;
    }

    const parentWin = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : undefined;
    const mainTab = this.tabs.get('main');
    // 共享主站 WebContents 的 session，实现 Cookies、IndexedDB 和 LocalStorage 存储池一体化
    const targetSession = mainTab?.view?.webContents?.session || session.defaultSession;

    const authWin = new BrowserWindow({
      width: 520,
      height: 680,
      center: true,
      parent: parentWin,
      modal: false,
      title: `${APP_CONFIG.appName} - Account Login`,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        session: targetSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        webSecurity: true,
      },
    });

    this.oauthWindow = authWin;
    authWin.setMenuBarVisibility(false);
    authWin.on('page-title-updated', (e) => e.preventDefault());

    // 使用标准桌面原生 Chrome User-Agent（平台自适应，Google OAuth 对原生 Chrome 完全放行）
    const oauthUA = APP_CONFIG.userAgent;
    authWin.webContents.setUserAgent(oauthUA);

    // 为 OAuth 页面注入原生运行环境垫片，彻底消除机器人与 WebView 识别特征
    const injectChromeShim = () => {
      if (authWin.isDestroyed()) return;
      authWin.webContents.executeJavaScript(`
        (function() {
          try {
            delete Object.getPrototypeOf(navigator).webdriver;
            delete navigator.webdriver;
          } catch(e) {}
          try {
            if (!window.chrome) window.chrome = {};
            if (!window.chrome.runtime) {
              window.chrome.runtime = {
                OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
                OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' }
              };
            }
            if (!window.chrome.loadTimes) window.chrome.loadTimes = function() { return {}; };
            if (!window.chrome.csi) window.chrome.csi = function() { return {}; };
            if (!window.chrome.app) {
              window.chrome.app = {
                isInstalled: false,
                InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
              };
            }
          } catch(e) {}
        })();
      `).catch(() => { });
    };

    authWin.webContents.on('did-start-loading', injectChromeShim);
    authWin.webContents.on('dom-ready', injectChromeShim);

    // 弹窗内部 window.open 处理：将非认证相关的外部帮助、隐私政策等页面导向系统浏览器
    authWin.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (!url) return { action: 'deny' };
        if (
          url.startsWith('https://support.google.com') ||
          url.startsWith('https://policies.google.com') ||
          url.startsWith('https://myaccount.google.com')
        ) {
          shell.openExternal(url).catch(() => { });
          return { action: 'deny' };
        }
      } catch { }
      return { action: 'allow' };
    });

    // 检查并同步登录状态
    let isSyncing = false;
    let pollTimer: NodeJS.Timeout | null = null;
    const checkAndSyncAuth = async (currentUrl: string): Promise<boolean> => {
      if (isSyncing || authWin.isDestroyed()) return false;
      try {
        const isShortVideo = currentUrl.includes('shortvideo.ca');
        if (!isShortVideo) return false;

        // 从当前弹窗中提取 token 与 user 信息
        const result = await authWin.webContents.executeJavaScript(`
          (() => {
            try {
              const token = localStorage.getItem('TokenKeyName');
              const user = localStorage.getItem('userData');
              return { token, user };
            } catch(e) {
              return null;
            }
          })()
        `);

        if (result && result.token) {
          isSyncing = true;
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          console.log('[WindowManager] 检测到 OAuth 登录成功，Token 已生成，开始将凭证同步至桌面客户端主站...');

          // 将 Cookie 立即刷新写入持久化磁盘
          try {
            await targetSession.cookies.flushStore();
          } catch { }

          await this.applyAuthToken(result.token, result.user);

          // 延迟 300ms 关闭弹窗，给用户良好的成功反馈感知
          setTimeout(() => {
            if (!authWin.isDestroyed()) {
              authWin.close();
            }
          }, 300);

          return true;
        }
      } catch (err: any) {
        console.warn('[WindowManager] 同步 OAuth Token 异常:', err?.message || err);
      }
      return false;
    };

    // 监听各类导航与完成事件
    const startPollingCheck = () => {
      if (pollTimer) return;
      let counter = 0;
      pollTimer = setInterval(async () => {
        counter++;
        if (authWin.isDestroyed() || counter > 40) {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          return;
        }
        const currentUrl = authWin.webContents.getURL() || '';
        const ok = await checkAndSyncAuth(currentUrl);
        if (ok && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 500);
    };

    authWin.webContents.on('did-navigate', (_e, url) => {
      if (url.includes('/oauth/callback') || url.includes('shortvideo.ca')) {
        startPollingCheck();
        checkAndSyncAuth(url).catch(() => { });
      }
    });

    authWin.webContents.on('did-navigate-in-page', (_e, url) => {
      if (url.includes('/oauth/callback') || url.includes('shortvideo.ca')) {
        startPollingCheck();
        checkAndSyncAuth(url).catch(() => { });
      }
    });

    authWin.webContents.on('did-redirect-navigation', (_e, url) => {
      if (url.includes('/oauth/callback') || url.includes('shortvideo.ca')) {
        startPollingCheck();
        checkAndSyncAuth(url).catch(() => { });
      }
    });

    authWin.webContents.on('dom-ready', () => {
      const url = authWin.webContents.getURL() || '';
      if (url.includes('/oauth/callback') || url.includes('shortvideo.ca')) {
        checkAndSyncAuth(url).catch(() => { });
      }
    });

    authWin.on('closed', () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      this.oauthWindow = null;
    });

    console.log('[WindowManager] 启动独立 OAuth 弹窗进行安全认证:', oauthUrl);
    authWin.loadURL(oauthUrl).catch((e) => {
      console.warn('[WindowManager] 加载 OAuth 链接失败:', e?.message || e);
    });
  }

  /**
   * 销毁所有视图
   */
  private destroyAll(): void {
    for (const [, tab] of this.tabs) {
      try {
        (tab.view.webContents as any).destroy();
      } catch { }
    }
    this.tabs.clear();
    sessionKeeper.destroy();

    if (this.tabBarView) {
      try {
        (this.tabBarView.webContents as any).destroy();
      } catch { }
      this.tabBarView = null;
    }

    // 销毁 Loading 遮罩视图，防止资源泄漏
    if (this.loadingView) {
      try {
        (this.loadingView.webContents as any).destroy();
      } catch { }
      this.loadingView = null;
    }

    if (this.oauthWindow && !this.oauthWindow.isDestroyed()) {
      try {
        this.oauthWindow.close();
      } catch { }
      this.oauthWindow = null;
    }

    if (this.logViewerWindow && !this.logViewerWindow.isDestroyed()) {
      try {
        this.logViewerWindow.close();
      } catch { }
      this.logViewerWindow = null;
    }

    if (this.aboutWindow && !this.aboutWindow.isDestroyed()) {
      try {
        this.aboutWindow.close();
      } catch { }
      this.aboutWindow = null;
    }

    this.mainWindow = null;
    this.isMainAppLoaded = false;
    this.isLoadingVisible = false;
    this.activeTabId = 'main';
  }

}

export const windowManager = new WindowManager();
