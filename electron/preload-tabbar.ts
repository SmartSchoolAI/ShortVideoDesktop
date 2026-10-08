import { contextBridge, ipcRenderer } from 'electron';

export interface TabItem {
  id: string;
  title: string;
  closable: boolean;
}

export interface TabsState {
  tabs: TabItem[];
  activeTabId: string;
  lang?: string;
}

export interface PlatformStepsData {
  platform: string;
  steps: string[];
  currentStep: number;
  state: 'pending' | 'active' | 'done' | 'error';
  timestamp?: number;
}

export interface PlatformStatusData {
  platform?: string;
  message?: string;
  status?: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  level?: string;
  progress?: number;
  dismiss?: boolean;
  timestamp?: number;
}

const tabBarAPI = {
  switchTab: (tabId: string) => {
    ipcRenderer.send('tabbar:switch', tabId);
  },

  closeTab: (tabId: string) => {
    ipcRenderer.send('tabbar:close', tabId);
  },

  openTab: (platformId: 'wechat' | 'xiaohongshu') => {
    ipcRenderer.send('tabbar:open-platform', platformId);
  },

  goBack: () => {
    ipcRenderer.send('tabbar:go-back');
  },

  goForward: () => {
    ipcRenderer.send('tabbar:go-forward');
  },

  reload: () => {
    ipcRenderer.send('tabbar:reload');
  },

  notifyReady: () => {
    ipcRenderer.send('tabbar:ready');
  },

  toggleDevTools: () => {
    ipcRenderer.send('tabbar:toggle-devtools');
  },

  openLogs: () => {
    ipcRenderer.send('tabbar:open-logs');
  },

  openRender: () => {
    ipcRenderer.send('tabbar:open-render');
  },

  onTabsUpdated: (callback: (state: TabsState) => void) => {
    const handler = (_event: any, state: TabsState) => callback(state);
    ipcRenderer.on('tabbar:state-update', handler);
    return () => {
      ipcRenderer.removeListener('tabbar:state-update', handler);
    };
  },

  /**
   * 监听原生流水线步骤更新
   */
  onStepsUpdated: (callback: (data: PlatformStepsData) => void) => {
    const handler = (_event: any, data: PlatformStepsData) => callback(data);
    ipcRenderer.on('platform:steps-update', handler);
    return () => {
      ipcRenderer.removeListener('platform:steps-update', handler);
    };
  },

  /**
   * 监听原生流水线消息状态通知
   */
  onStatusUpdated: (callback: (data: PlatformStatusData) => void) => {
    const handler = (_event: any, data: PlatformStatusData) => callback(data);
    ipcRenderer.on('platform:status-update', handler);
    return () => {
      ipcRenderer.removeListener('platform:status-update', handler);
    };
  },

  /**
   * 监听主站语言切换
   */
  onLanguageChanged: (callback: (lang: string) => void) => {
    const handler = (_event: any, lang: string) => callback(lang);
    ipcRenderer.on('tabbar:language-change', handler);
    return () => {
      ipcRenderer.removeListener('tabbar:language-change', handler);
    };
  },

  /**
   * 监听视频渲染状态更新
   */
  onRenderStatusUpdated: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('render:status-update', handler);
    return () => {
      ipcRenderer.removeListener('render:status-update', handler);
    };
  },

  /**
   * 唤起原生语言选择菜单
   */
  openLanguageMenu: (x?: number, y?: number) => {
    ipcRenderer.send('tabbar:open-language-menu', { x, y });
  },

  /**
   * 打开系统说明与关于弹窗
   */
  openAbout: () => {
    ipcRenderer.send('tabbar:open-about');
  },

  /**
   * 切换系统日志分类 ('all' | 'wechat' | 'xiaohongshu' | 'system')
   */
  switchSyslogCategory: (category: string) => {
    ipcRenderer.invoke('syslog:switch-category', category);
  },

  /**
   * 获取当前日志各分类统计
   */
  getSyslogCounts: () => {
    return ipcRenderer.invoke('syslog:get-counts');
  },

  /**
   * 监听日志分类计数与当前分类变更
   */
  onSyslogCountsUpdated: (callback: (data: { category: string; counts: { all: number; wechat: number; xiaohongshu: number; system: number } }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('syslog:counts-update', handler);
    return () => {
      ipcRenderer.removeListener('syslog:counts-update', handler);
    };
  },

  /**
   * 监听自动更新状态
   */
  onUpdateStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('app:update-status', handler);
    return () => {
      ipcRenderer.removeListener('app:update-status', handler);
    };
  },

  /**
   * 立即退出客户端并重启进入新版本
   */
  quitAndInstall: () => {
    ipcRenderer.send('app:quit-and-install');
  },

  /**
   * 获取当前更新状态缓存
   */
  getUpdateStatus: () => {
    return ipcRenderer.invoke('app:get-update-status');
  },

  /**
   * 手动检查新版本
   */
  checkForUpdates: () => {
    return ipcRenderer.invoke('app:check-for-updates');
  },
};

contextBridge.exposeInMainWorld('tabBarAPI', tabBarAPI);

export type TabBarAPI = typeof tabBarAPI;
