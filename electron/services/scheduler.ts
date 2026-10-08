import fs from 'fs';
import path from 'path';
import { app, Notification } from 'electron';
import { windowManager } from './window-manager';
import { getLocale, formatI18n } from '../utils/i18n';

export interface ScheduledTaskItem {
  id: string; // 唯一键，例如 `${platform}_${taskId}`
  taskId: string;
  platform: 'wechat' | 'xiaohongshu' | 'bilibili' | 'douyin';
  videoUrl: string;
  title: string;
  description: string;
  tags?: string[];
  scheduledPublishAt: number; // 计划执行时间戳 (ms)
  status: 'pending' | 'executing' | 'success' | 'failed';
  error?: string;
  executedAt?: number;
  wordA?: string;
  wordB?: string;
}

export type TaskExecutor = (task: ScheduledTaskItem) => Promise<{ success: boolean; message?: string }>;

class LocalPublishScheduler {
  private tasks: Map<string, ScheduledTaskItem> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private executor: TaskExecutor | null = null;
  private storageFilePath: string = '';

  constructor() {
    // 延迟获取路径，确保 app ready 之后可正确解析 userData
  }

  public init(executor: TaskExecutor): void {
    this.executor = executor;
    try {
      const userDataDir = app.getPath('userData');
      this.storageFilePath = path.join(userDataDir, 'scheduled-publish-tasks.json');
      this.loadFromDisk();
      // 客户端启动自愈：检查是否有此前发布失败或异常中断的视频任务，立即安排重新发布处理
      this.recoverFailedTasksOnStartup();
    } catch (err) {
      console.warn('[Scheduler] 初始化存储路径失败:', err);
    }
    this.start();
  }

  /**
   * 客户端重新启动时自愈恢复：
   * 若发现存在状态为 failed 或异常中断 executing 的视频任务，立即将其重置为待发布并直接处理
   */
  private recoverFailedTasksOnStartup(): void {
    const failedTasks: ScheduledTaskItem[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'failed' || task.status === 'executing') {
        task.status = 'pending';
        task.scheduledPublishAt = Date.now();
        task.error = undefined;
        failedTasks.push(task);
      }
    }

    if (failedTasks.length > 0) {
      console.log(
        `[Scheduler] 🔄 客户端启动检测到 ${failedTasks.length} 个此前发布失败/中断的视频任务，立即安排重新发布: ` +
        failedTasks.map((t) => `【${this.getPlatformName(t.platform)}】${t.title}`).join(', ')
      );
      this.saveToDisk();
      this.broadcastUpdate();
      const curLang = windowManager.getCurrentLanguage();
      const loc = getLocale(curLang);
      this.showNotification(
        loc.notifications.autoRetryTitle || '自动重试发布',
        formatI18n(
          loc.notifications.autoRetryBody || '检测到 {count} 个此前未成功发布的视频，已自动重新安排立即发布处理！',
          { count: failedTasks.length }
        )
      );
      // 启动 3 秒后待窗口与平台环境就绪即刻开始发布
      setTimeout(() => this.tick(), 3000);
    }
  }

  /**
   * 手动或按需立即重新发布所有失败/中断的任务
   */
  public retryFailedTasks(): ScheduledTaskItem[] {
    const retried: ScheduledTaskItem[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'failed' || task.status === 'executing') {
        task.status = 'pending';
        task.scheduledPublishAt = Date.now();
        task.error = undefined;
        retried.push(task);
      }
    }
    if (retried.length > 0) {
      this.saveToDisk();
      this.broadcastUpdate();
      console.log(`[Scheduler] 已手动重置 ${retried.length} 个失败任务并立即执行`);
      setTimeout(() => this.tick(), 500);
    }
    return retried;
  }

  /**
   * 启动定时轮询监听（每 15 秒检查一次是否有到达定时时间的任务）
   */
  public start(): void {
    if (this.timer) return;
    console.log('[Scheduler] 本地定时发布调度服务已启动，轮询周期: 15s');
    this.timer = setInterval(() => {
      this.tick();
    }, 15000);
    // 启动后立即检查一次
    setTimeout(() => this.tick(), 2000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 批量添加或更新定时任务
   */
  public addTasks(newTasks: ScheduledTaskItem[]): ScheduledTaskItem[] {
    for (const t of newTasks) {
      const existing = this.tasks.get(t.id);
      // 如果已存在且处于成功状态，允许重新排期
      this.tasks.set(t.id, {
        ...existing,
        ...t,
        status: 'pending',
      });
    }
    this.saveToDisk();
    this.broadcastUpdate();
    console.log(`[Scheduler] 成功添加/更新 ${newTasks.length} 个定时任务`);
    // 添加后立刻触发一次检查
    setTimeout(() => this.tick(), 500);
    return this.getAllTasks();
  }

  /**
   * 取消指定的定时发布任务
   */
  public cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    this.tasks.delete(id);
    this.saveToDisk();
    this.broadcastUpdate();
    console.log(`[Scheduler] 已取消定时任务: ${id}`);
    return true;
  }

  /**
   * 获取当前全部定时任务
   */
  public getAllTasks(): ScheduledTaskItem[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 定时心跳轮询：扫描到达时间的待发布任务
   */
  private async tick(): Promise<void> {
    if (this.isProcessing || !this.executor) return;

    const now = Date.now();
    // 查找已到期且待执行的任务 (允许 30 秒容差)
    const dueTasks: ScheduledTaskItem[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && task.scheduledPublishAt <= now + 1000) {
        dueTasks.push(task);
      }
    }

    if (dueTasks.length === 0) return;

    // 按计划时间先后排序，先到期的先执行
    dueTasks.sort((a, b) => a.scheduledPublishAt - b.scheduledPublishAt);

    this.isProcessing = true;
    try {
      for (const task of dueTasks) {
        console.log(`[Scheduler] ⏰ 到达定时时间！准备自动执行上传任务 [${task.platform}] - ${task.title}`);
        task.status = 'executing';
        this.broadcastUpdate();

        const curLang = windowManager.getCurrentLanguage();
        const loc = getLocale(curLang);
        const pName = this.getPlatformName(task.platform, curLang);

        try {
          const res = await this.executor(task);
          if (res.success) {
            task.status = 'success';
            task.executedAt = Date.now();
            console.log(`[Scheduler] ✅ 定时发布成功: ${task.title}`);
            const body = formatI18n(loc.notifications.scheduleSuccessBody, { platform: pName, title: task.title });
            this.showNotification(loc.notifications.scheduleSuccessTitle, body);
          } else {
            task.status = 'failed';
            task.error = res.message || '发布未成功';
            console.warn(`[Scheduler] ❌ 定时发布未成功: ${task.title}`, res.message);
            const body = formatI18n(loc.notifications.scheduleFailedBody, { platform: pName, title: task.title, error: task.error || '' });
            this.showNotification(loc.notifications.scheduleFailedTitle, body);
          }
        } catch (execErr: any) {
          task.status = 'failed';
          task.error = execErr?.message || '执行异常';
          console.error(`[Scheduler] ❌ 执行定时发布异常:`, execErr);
          const body = formatI18n(loc.notifications.scheduleErrorBody, { platform: pName, title: task.title, error: task.error || '' });
          this.showNotification(loc.notifications.scheduleErrorTitle, body);
        }

        this.saveToDisk();
        this.broadcastUpdate();

        // 两个连续自动发布之间留出 5 秒冷却时间，避免界面频繁切换
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private broadcastUpdate(): void {
    windowManager.broadcast('scheduler:tasks-updated', this.getAllTasks());
  }

  private showNotification(title: string, body: string): void {
    try {
      if (Notification.isSupported()) {
        const notif = new Notification({
          title: `ShortVideo: ${title}`,
          body,
          silent: false,
        });
        notif.show();
      }
    } catch (e) {
      console.warn('[Scheduler] 弹出系统通知异常:', e);
    }
  }

  private getPlatformName(platform: string, lang?: string): string {
    const loc = getLocale(lang || windowManager.getCurrentLanguage());
    switch (platform) {
      case 'wechat': return loc.platforms.wechat;
      case 'xiaohongshu': return loc.platforms.xiaohongshu;
      case 'bilibili': return 'Bilibili';
      case 'douyin': return 'Douyin';
      default: return platform;
    }
  }

  private loadFromDisk(): void {
    if (!this.storageFilePath || !fs.existsSync(this.storageFilePath)) return;
    try {
      const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
      const list: ScheduledTaskItem[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        this.tasks.clear();
        for (const item of list) {
          this.tasks.set(item.id, item);
        }
        console.log(`[Scheduler] 已从本地文件加载 ${this.tasks.size} 个定时任务`);
      }
    } catch (err) {
      console.warn('[Scheduler] 读取本地持久化任务失败:', err);
    }
  }

  private saveToDisk(): void {
    if (!this.storageFilePath) return;
    try {
      const list = Array.from(this.tasks.values());
      fs.writeFileSync(this.storageFilePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[Scheduler] 保存本地任务文件失败:', err);
    }
  }
}

export const localScheduler = new LocalPublishScheduler();
