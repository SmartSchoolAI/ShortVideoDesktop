import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronPublishPayload {
  videoId: string;
  videoUrl: string;
  title: string;
  description: string;
  tags?: string[];
  coverUrl?: string;
  scheduledPublishAt?: number;
}

const electronAPI = {
  isElectron: true,

  /**
   * 打开指定平台的发布站点窗口
   */
  openPlatformWindow: (platform: 'wechat' | 'xiaohongshu') => {
    return ipcRenderer.invoke('platform:open-window', platform);
  },

  /**
   * 触发一键自动发布到指定平台
   */
  publishToPlatform: (platform: 'wechat' | 'xiaohongshu', payload: ElectronPublishPayload) => {
    return ipcRenderer.invoke('platform:publish', { platform, payload });
  },

  /**
   * 订阅发布状态与进度更新
   */
  onPublishStatus: (callback: (data: { platform: string; status: string; progress?: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('platform:status-update', handler);
    return () => {
      ipcRenderer.removeListener('platform:status-update', handler);
    };
  },

  /**
   * 获取应用环境信息
   */
  getAppInfo: () => {
    return ipcRenderer.invoke('app:get-info');
  },

  /**
   * 批量添加本地定时发布任务
   */
  addScheduledTasks: (tasks: any[]) => {
    return ipcRenderer.invoke('scheduler:add-tasks', tasks);
  },

  /**
   * 获取本地全部排期定时任务
   */
  getScheduledTasks: () => {
    return ipcRenderer.invoke('scheduler:get-tasks');
  },

  /**
   * 取消指定的定时发布任务
   */
  cancelScheduledTask: (id: string) => {
    return ipcRenderer.invoke('scheduler:cancel-task', id);
  },

  /**
   * 立即重新发布所有失败/中断的定时发布任务
   */
  retryFailedScheduledTasks: () => {
    return ipcRenderer.invoke('scheduler:retry-failed');
  },

  /**
   * 监听本地定时任务状态变化广播
   */
  onScheduledTasksUpdated: (callback: (tasks: any[]) => void) => {
    const handler = (_event: any, tasks: any[]) => callback(tasks);
    ipcRenderer.on('scheduler:tasks-updated', handler);
    return () => {
      ipcRenderer.removeListener('scheduler:tasks-updated', handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
