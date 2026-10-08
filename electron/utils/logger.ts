import { app, ipcMain, shell, dialog, WebContents, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * 结构化系统日志条目
 */
export interface SystemLogEntry {
  id: number;
  timestamp: string;      // 例如 "2026-09-26 14:33:51 GMT-07:00"
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string;
}

/**
 * 获取符合标准的本地日期、时间和时区字符串
 * 格式：YYYY-MM-DD HH:mm:ss GMT±HH:mm
 */
export function getLogTimestamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // 计算时区偏移（时区偏差分钟数，负值代表东时区，如北京时间东八区为 -480）
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetMins = String(absOffset % 60).padStart(2, '0');
  const tz = `GMT${sign}${offsetHours}:${offsetMins}`;

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${tz}`;
}

/**
 * 全局系统日志服务中心 (SystemLogger)
 * 特性：
 * 1. 内存环形缓冲区：保留最近 2500 条结构化日志供 UI 秒级渲染与过滤；
 * 2. 磁盘文件持久化：写入 app.getPath('userData')/logs/shortvideo-YYYY-MM-DD.log，生产环境打包安装后完整留痕；
 * 3. 实时 IPC 广播：日志产生时实时推送到系统日志查看器窗口；
 * 4. 完美接管并格式化 console.log / info / warn / error。
 */
class SystemLoggerService {
  private static instance: SystemLoggerService;
  private logBuffer: SystemLogEntry[] = [];
  private readonly MAX_BUFFER_SIZE = 2500;
  private nextId = 1;
  private logDirectory: string = '';
  private currentLogFilePath: string = '';
  private isInitialized = false;
  private subscribers: Set<WebContents> = new Set();

  private constructor() {}

  public static getInstance(): SystemLoggerService {
    if (!SystemLoggerService.instance) {
      SystemLoggerService.instance = new SystemLoggerService();
    }
    return SystemLoggerService.instance;
  }

  /**
   * 初始化日志服务：拦截控制台输出并配置文件流
   */
  public init(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. 解析日志保存目录
    try {
      const userData = app.isReady() ? app.getPath('userData') : process.cwd();
      this.logDirectory = path.join(userData, 'logs');
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      this.currentLogFilePath = path.join(this.logDirectory, `shortvideo-${todayStr}.log`);

      const appVersion = (() => {
        try {
          return app.getVersion();
        } catch {
          try { return require('../../package.json').version || '0.1.0'; } catch { return '0.1.0'; }
        }
      })();
      const appTag = appVersion.startsWith('v') ? appVersion : `v${appVersion}`;

      // 写入本次启动元信息
      const startBanner = `\n==================== [ShortVideo Startup / 启动 ${getLogTimestamp()}] ====================\n` +
        `Version / 软件版本: ${appTag}\n` +
        `Mode / 模式: ${app.isPackaged ? 'Packaged Production' : 'Development'} | ` +
        `Electron: ${process.versions.electron} | Chrome: ${process.versions.chrome} | Node: ${process.versions.node} | OS: ${process.platform} ${process.arch}\n` +
        `Log File / 日志文件: ${this.currentLogFilePath}\n` +
        `========================================================================================\n\n`;
      fs.appendFileSync(this.currentLogFilePath, startBanner, 'utf-8');
    } catch (e) {
      // 容错
    }

    // 2. 接管 Node.js 全局 console 体系
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args: any[]) => {
      const formattedTimestamp = `[${getLogTimestamp()}]`;
      originalLog.call(console, formattedTimestamp, ...args);
      this.appendEntry('info', args);
    };

    console.info = (...args: any[]) => {
      const formattedTimestamp = `[${getLogTimestamp()}]`;
      originalInfo.call(console, formattedTimestamp, ...args);
      this.appendEntry('info', args);
    };

    console.warn = (...args: any[]) => {
      const formattedTimestamp = `[${getLogTimestamp()}]`;
      originalWarn.call(console, formattedTimestamp, ...args);
      this.appendEntry('warn', args);
    };

    console.error = (...args: any[]) => {
      const formattedTimestamp = `[${getLogTimestamp()}]`;
      originalError.call(console, formattedTimestamp, ...args);
      this.appendEntry('error', args);
    };

    // 3. 注册 IPC 接口供日志窗口交互
    this.registerIpcHandlers();

    // 4. 将软件版本 (TAG) 作为启动首批系统日志留痕
    try {
      const ver = app.getVersion();
      const tag = ver.startsWith('v') ? ver : `v${ver}`;
      console.log(`[System] App Version: ${tag}`);
    } catch {}
  }

  /**
   * 注册日志查看窗口为实时推送订阅者
   */
  public subscribe(webContents: WebContents): void {
    if (!webContents || webContents.isDestroyed()) return;
    this.subscribers.add(webContents);
    webContents.once('destroyed', () => {
      this.subscribers.delete(webContents);
    });
  }

  /**
   * 内部处理控制台参数转换为结构化条目并持久化
   */
  private appendEntry(rawLevel: 'info' | 'warn' | 'error', args: any[]): void {
    try {
      const timestamp = getLogTimestamp();

      // 参数序列化
      const messageParts: string[] = [];
      const detailParts: string[] = [];

      for (let i = 0; i < args.length; i++) {
        const item = args[i];
        if (typeof item === 'string') {
          messageParts.push(item);
        } else if (item instanceof Error) {
          messageParts.push(item.message);
          if (item.stack) detailParts.push(item.stack);
        } else if (typeof item === 'object' && item !== null) {
          try {
            detailParts.push(JSON.stringify(item, null, 2));
          } catch {
            detailParts.push(String(item));
          }
        } else {
          messageParts.push(String(item));
        }
      }

      let mainMessage = messageParts.join(' ').trim();
      let level: 'info' | 'warn' | 'error' | 'success' = rawLevel;

      // 智能识别 success 级别
      if (mainMessage.includes('[成功]') || mainMessage.includes('✅') || mainMessage.includes('🎉') || mainMessage.includes('成功')) {
        if (level === 'info') level = 'success';
      }

      const details = detailParts.length > 0 ? detailParts.join('\n') : undefined;

      const entry: SystemLogEntry = {
        id: this.nextId++,
        timestamp,
        level,
        message: mainMessage,
        details,
      };

      // 放入内存 Ring Buffer
      this.logBuffer.push(entry);
      if (this.logBuffer.length > this.MAX_BUFFER_SIZE) {
        this.logBuffer.shift();
      }

      // 写入本地持久化文件
      this.writeLineToFile(entry);

      // 广播给活跃的日志查看器窗口（快照遍历，安全清理失效订阅者）
      for (const wc of Array.from(this.subscribers)) {
        if (!wc.isDestroyed()) {
          try {
            wc.send('syslog:entry', entry);
          } catch {}
        } else {
          this.subscribers.delete(wc);
        }
      }
    } catch {
      // 坚决防止日志拦截器自身抛出异常引发应用崩溃
    }
  }

  /**
   * 追加写入文件
   */
  private writeLineToFile(entry: SystemLogEntry): void {
    if (!this.currentLogFilePath) return;
    try {
      const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${entry.details ? '\n' + entry.details : ''}\n`;
      fs.appendFile(this.currentLogFilePath, line, 'utf-8', () => {});
    } catch {}
  }

  /**
   * 获取最近的历史日志条目
   */
  public getHistory(): SystemLogEntry[] {
    return [...this.logBuffer];
  }

  /**
   * 获取当前持久化日志文件路径
   */
  public getCurrentLogFilePath(): string {
    return this.currentLogFilePath;
  }

  /**
   * 清空内存日志
   */
  public clear(): void {
    this.logBuffer = [];
    for (const wc of Array.from(this.subscribers)) {
      if (!wc.isDestroyed()) {
        try {
          wc.send('syslog:cleared');
        } catch {}
      } else {
        this.subscribers.delete(wc);
      }
    }
  }

  /**
   * 获取日志文件路径与目录信息
   */
  public getLogInfo(): { filePath: string; directory: string; count: number } {
    return {
      filePath: this.currentLogFilePath,
      directory: this.logDirectory,
      count: this.logBuffer.length,
    };
  }

  /**
   * 打开日志所在系统文件夹
   */
  public openLogFolder(): boolean {
    try {
      if (this.currentLogFilePath && fs.existsSync(this.currentLogFilePath)) {
        shell.showItemInFolder(this.currentLogFilePath);
        return true;
      }
      if (this.logDirectory && fs.existsSync(this.logDirectory)) {
        shell.openPath(this.logDirectory);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 导出当前日志文件到指定位置
   */
  public async exportLogs(targetWindow?: any): Promise<boolean> {
    try {
      let lang = 'zh';
      try {
        const { windowManager } = require('../services/window-manager');
        lang = windowManager?.getCurrentLanguage?.() || 'zh';
      } catch {}
      const { getLocale } = require('./i18n');
      const loc = getLocale(lang);

      const defaultName = `shortvideo-logs-${new Date().toISOString().slice(0, 10)}.log`;
      const { canceled, filePath } = await dialog.showSaveDialog(targetWindow || null, {
        title: loc.dialogs.exportLogsTitle,
        defaultPath: defaultName,
        filters: [{ name: loc.dialogs.logFileFilter, extensions: ['log', 'txt'] }],
      });

      if (canceled || !filePath) return false;

      // 如果有当前日志文件直接复制，否则将缓冲区内存导出
      if (this.currentLogFilePath && fs.existsSync(this.currentLogFilePath)) {
        fs.copyFileSync(this.currentLogFilePath, filePath);
        return true;
      } else {
        const content = this.logBuffer
          .map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] ${e.message}${e.details ? '\n' + e.details : ''}`)
          .join('\n');
        fs.writeFileSync(filePath, content, 'utf-8');
        return true;
      }
    } catch {
      return false;
    }
  }

  /**
   * 注册 IPC 接口
   */
  private registerIpcHandlers(): void {
    ipcMain.handle('syslog:get-history', () => {
      return this.getHistory();
    });

    ipcMain.handle('syslog:get-info', () => {
      return this.getLogInfo();
    });

    ipcMain.handle('syslog:get-counts', () => {
      let wechatCount = 0;
      let xhsCount = 0;
      let sysCount = 0;
      for (const log of this.logBuffer) {
        const text = ((log.message || '') + ' ' + (log.details || '')).toLowerCase();
        if (
          text.includes('wechatchannels') ||
          text.includes('微信视频号') ||
          text.includes('channels.weixin') ||
          text.includes('视频号') ||
          text.includes('wechat')
        ) {
          wechatCount++;
        } else if (
          text.includes('xiaohongshu') ||
          text.includes('小红书') ||
          text.includes('creator.xiaohongshu') ||
          text.includes('xhs')
        ) {
          xhsCount++;
        } else {
          sysCount++;
        }
      }
      return {
        all: this.logBuffer.length,
        wechat: wechatCount,
        xiaohongshu: xhsCount,
        system: sysCount,
      };
    });

    ipcMain.handle('syslog:clear', () => {
      this.clear();
      return true;
    });

    ipcMain.handle('syslog:open-folder', () => {
      return this.openLogFolder();
    });

    ipcMain.handle('syslog:export', async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender) || undefined;
      return await this.exportLogs(win);
    });

    ipcMain.handle('syslog:switch-category', (_event, category: string) => {
      for (const wc of Array.from(this.subscribers)) {
        if (!wc.isDestroyed()) {
          try {
            wc.send('syslog:set-category', category);
          } catch {}
        } else {
          this.subscribers.delete(wc);
        }
      }
      return true;
    });

    ipcMain.on('syslog:category-counts-update', (_event, data: any) => {
      for (const wc of Array.from(this.subscribers)) {
        if (!wc.isDestroyed()) {
          try {
            wc.send('syslog:counts-update', data);
          } catch {}
        } else {
          this.subscribers.delete(wc);
        }
      }
    });
  }
}

export const systemLogger = SystemLoggerService.getInstance();

/**
 * 启动控制台增强与系统日志收集
 */
export function setupConsoleLogger(): void {
  systemLogger.init();
}
