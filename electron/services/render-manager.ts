import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app, ipcMain, WebContents, dialog, shell } from 'electron';
import { APP_CONFIG } from '../config';

export interface RenderLogEntry {
  id: number;
  timestamp: string;
  type: 'stdout' | 'stderr' | 'system' | 'info' | 'success' | 'error';
  text: string;
  count?: number;
  progress?: {
    current: number;
    total: number;
    percent: number;
    eta?: string;
  };
}

export type RenderStatus = 'idle' | 'running' | 'success' | 'error';

export interface RenderState {
  status: RenderStatus;
  startTime: number | null;
  endTime: number | null;
  durationMs: number;
  exitCode: number | null;
  totalLogs: number;
}

/**
 * 视频渲染任务管理器 (RenderManager)
 * 负责调度、监控与管理 `pnpm run render` (CompareEnglishWord.ts) 的执行与日志流
 */
export class RenderManager {
  private static instance: RenderManager | null = null;
  private currentProcess: ChildProcess | null = null;
  private logs: RenderLogEntry[] = [];
  private maxLogs = 5000;
  private nextLogId = 1;
  private activeProgressLogId: number | null = null;
  private activeIdleLogId: number | null = null;
  private status: RenderStatus = 'idle';
  private startTime: number | null = null;
  private endTime: number | null = null;
  private exitCode: number | null = null;
  private subscribers: Set<WebContents> = new Set();

  private constructor() {
    this.registerIpc();
  }

  public static getInstance(): RenderManager {
    if (!RenderManager.instance) {
      RenderManager.instance = new RenderManager();
    }
    return RenderManager.instance;
  }

  private configuredProjectDir: string = '';

  private getSettingsPath(): string {
    return path.join(app.getPath('userData'), 'app-settings.json');
  }

  private loadSavedProjectDir(): string {
    try {
      const cfg = this.getSettingsPath();
      if (fs.existsSync(cfg)) {
        const data = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
        if (data.projectDir && fs.existsSync(data.projectDir)) {
          return data.projectDir;
        }
      }
    } catch {}
    return '';
  }

  private saveProjectDir(dir: string): void {
    try {
      const cfg = this.getSettingsPath();
      let currentData: any = {};
      if (fs.existsSync(cfg)) {
        try {
          currentData = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
        } catch {}
      }
      currentData.projectDir = dir;
      fs.writeFileSync(cfg, JSON.stringify(currentData, null, 2), 'utf-8');
      this.configuredProjectDir = dir;
    } catch (err) {
      console.warn('[RenderManager] 保存项目目录配置失败:', err);
    }
  }

  /**
   * 注册 IPC 接口供视图层和标签栏交互
   */
  private registerIpc(): void {
    ipcMain.handle('render:start', async () => {
      return this.startRender();
    });

    ipcMain.handle('render:stop', async () => {
      return this.stopRender();
    });

    ipcMain.handle('render:clear', async () => {
      this.clearLogs();
      return { success: true };
    });

    ipcMain.handle('render:get-state', async () => {
      return {
        state: this.getState(),
        logs: this.logs,
        projectDir: this.resolvePhysicalWorkingDir(),
      };
    });

    ipcMain.handle('render:get-project-dir', async () => {
      return this.resolvePhysicalWorkingDir();
    });

    ipcMain.handle('render:set-project-dir', async (_event, dir: string) => {
      if (dir && fs.existsSync(dir)) {
        this.saveProjectDir(dir);
        this.appendLog('system', `📁 项目源码工作目录已更新为: ${dir}`);
        return { success: true, projectDir: dir };
      }
      return { success: false, message: '指定的目录不存在' };
    });

    ipcMain.handle('render:select-project-dir', async () => {
      let lang = 'zh';
      try {
        const { windowManager } = require('./window-manager');
        lang = windowManager?.getCurrentLanguage?.() || 'zh';
      } catch {}
      const { getLocale } = require('../utils/i18n');
      const loc = getLocale(lang);

      const result = await dialog.showOpenDialog({
        title: loc.dialogs.selectProjectDirTitle,
        properties: ['openDirectory'],
      });
      if (!result.canceled && result.filePaths.length > 0) {
        const selected = result.filePaths[0];
        this.saveProjectDir(selected);
        this.appendLog('system', `📁 用户已手动指定项目源码目录: ${selected}`);
        return { success: true, projectDir: selected };
      }
      return { success: false };
    });

    ipcMain.handle('render:open-output-dir', async () => {
      try {
        const userDataDir = app.getPath('userData');
        const defaultOutputDir = path.join(userDataDir, 'out');
        const candidateOutDirs = [
          path.join(defaultOutputDir, 'CompareEnglishWord'),
          defaultOutputDir,
          path.join(this.resolvePhysicalWorkingDir(), 'out', 'CompareEnglishWord'),
        ];
        for (const outDir of candidateOutDirs) {
          if (fs.existsSync(outDir)) {
            await shell.openPath(outDir);
            return { success: true, openedPath: outDir };
          }
        }
        if (!fs.existsSync(defaultOutputDir)) {
          fs.mkdirSync(defaultOutputDir, { recursive: true });
        }
        await shell.openPath(defaultOutputDir);
        return { success: true, openedPath: defaultOutputDir };
      } catch (err: any) {
        return { success: false, message: err.message };
      }
    });
  }

  /**
   * 订阅日志与状态实时推送
   */
  public subscribe(webContents: WebContents): void {
    if (webContents.isDestroyed()) return;
    this.subscribers.add(webContents);

    webContents.once('destroyed', () => {
      this.subscribers.delete(webContents);
    });

    // 立即向新订阅者推送当前状态和已有日志
    try {
      webContents.send('render:init', {
        state: this.getState(),
        logs: this.logs,
        projectDir: this.resolvePhysicalWorkingDir(),
      });
    } catch { }
  }

  public getState(): RenderState {
    const durationMs = this.startTime
      ? (this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime)
      : 0;

    return {
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs,
      exitCode: this.exitCode,
      totalLogs: this.logs.length,
    };
  }

  private broadcast(channel: string, payload: any): void {
    // 仅向已明确订阅的视图推送（render-viewer），不向平台标签页等无关 WebContents 广播
    for (const wc of this.subscribers) {
      if (!wc.isDestroyed()) {
        try {
          wc.send(channel, payload);
        } catch { }
      }
    }
  }

  /**
   * 判断是否为 Remotion 渲染进度日志
   */
  private isRenderProgress(t: string): boolean {
    if (!t) return false;
    return /Rendered\s+\d+\/\d+/i.test(t) ||
      /time remaining/i.test(t) ||
      /Rendering frame\s+\d+/i.test(t) ||
      /\[\s*\d+%\s*\]/i.test(t);
  }

  /**
   * 判断是否为轮询等待心跳日志
   */
  private isIdleWaitLog(t: string): boolean {
    if (!t) return false;
    return t.includes('当前队列中没有视频任务') ||
      t.includes('等待中...') ||
      t.includes('渲染调度服务端连接正常');
  }

  /**
   * 判断两条日志是否为近似的进度/轮询日志（如 Remotion 渲染进度、等待轮询等）
   */
  private isSimilarProgressLog(prevText: string, newText: string): boolean {
    if (!prevText || !newText) return false;

    // 1. Remotion 渲染帧进度
    if (this.isRenderProgress(prevText) && this.isRenderProgress(newText)) {
      return true;
    }

    // 2. 轮询等待与心跳日志：去除时间戳与数字后完全相同
    const normalize = (t: string) =>
      t
        .replace(/\[\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\]/g, '')
        .replace(/\d+/g, '#')
        .replace(/\s+/g, ' ')
        .trim();

    const patA = normalize(prevText);
    const patB = normalize(newText);
    if (patA === patB && patA.length >= 8) {
      return true;
    }

    return false;
  }

  /**
   * 解析日志文本中的帧进度与百分比
   */
  private parseProgress(text: string): RenderLogEntry['progress'] | undefined {
    // 匹配 Remotion 输出: Rendered 416/607, time remaining: 9s
    const m = text.match(/Rendered\s+(\d+)\/(\d+)(?:,\s*time remaining:\s*([0-9a-zA-Z\s]+))?/i);
    if (m) {
      const cur = parseInt(m[1], 10);
      const tot = parseInt(m[2], 10);
      if (tot > 0) {
        return {
          current: cur,
          total: tot,
          percent: Math.min(100, Math.round((cur / tot) * 1000) / 10),
          eta: m[3] ? m[3].trim() : undefined,
        };
      }
    }
    // 匹配百分比进度: [45%] 或 45.5%
    const m2 = text.match(/(\d+(?:\.\d+)?)%/);
    if (m2) {
      const pct = parseFloat(m2[1]);
      if (!isNaN(pct) && pct <= 100) {
        return {
          current: pct,
          total: 100,
          percent: pct,
        };
      }
    }
    return undefined;
  }

  private appendLog(type: RenderLogEntry['type'], text: string): void {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${now.getMilliseconds().toString().padStart(3, '0')}`;

    const progress = this.parseProgress(text);
    const isProgressText = this.isRenderProgress(text);
    const isIdleText = this.isIdleWaitLog(text);

    // 1. 如果是渲染帧进度日志 (如 Rendered 133/660...)，持续原地覆写该行
    if (isProgressText) {
      if (this.activeProgressLogId !== null) {
        const existing = this.logs.find((l) => l.id === this.activeProgressLogId);
        if (existing) {
          existing.timestamp = timestamp;
          existing.text = text;
          existing.count = (existing.count || 1) + 1;
          if (progress) {
            existing.progress = progress;
            this.broadcast('render:progress-update', progress);
          }
          this.broadcast('render:log-update', existing);
          return;
        }
      }
    }

    // 2. 如果是轮询等待心跳日志 (如 渲染调度服务端连接正常，当前队列中没有视频任务...)，持续原地覆写
    if (isIdleText) {
      if (this.activeIdleLogId !== null) {
        const existing = this.logs.find((l) => l.id === this.activeIdleLogId);
        if (existing) {
          existing.timestamp = timestamp;
          existing.text = text;
          existing.count = (existing.count || 1) + 1;
          this.broadcast('render:log-update', existing);
          return;
        }
      }
    }

    // 3. 通用相似连续日志合并 (如连续重复的普通输出)
    const lastLog = this.logs.length > 0 ? this.logs[this.logs.length - 1] : null;
    if (lastLog && lastLog.type === type && this.isSimilarProgressLog(lastLog.text, text)) {
      lastLog.timestamp = timestamp;
      lastLog.text = text;
      lastLog.count = (lastLog.count || 1) + 1;
      if (progress) {
        lastLog.progress = progress;
        this.broadcast('render:progress-update', progress);
      }
      this.broadcast('render:log-update', lastLog);
      return;
    }

    // 若输出非心跳日志，重置当前心跳行追踪
    if (!isIdleText) {
      this.activeIdleLogId = null;
    }

    // 若一个渲染阶段结束或进入新步骤（如完成、失败、开始新语言），重置 activeProgressLogId
    if (text.includes('渲染完成') || text.includes('渲染失败') || text.includes('▶️') || text.includes('🏆') || text.includes('全部')) {
      this.activeProgressLogId = null;
    }

    const entry: RenderLogEntry = {
      id: this.nextLogId++,
      timestamp,
      type,
      text,
      count: 1,
      progress,
    };

    if (isProgressText) {
      this.activeProgressLogId = entry.id;
    } else if (isIdleText) {
      this.activeIdleLogId = entry.id;
    }

    if (progress) {
      this.broadcast('render:progress-update', progress);
    }

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.broadcast('render:log', entry);
  }

  public clearLogs(): void {
    this.logs = [];
    this.activeProgressLogId = null;
    this.activeIdleLogId = null;
    this.broadcast('render:cleared', {});
  }

  /**
   * 解析可执行的物理工作目录（彻底过滤 .asar 虚拟路径，纯动态探测）
   */
  public resolvePhysicalWorkingDir(): string {
    // 1. 用户自定义配置目录优先
    const saved = this.loadSavedProjectDir();
    if (saved && !saved.includes('.asar') && fs.existsSync(path.join(saved, 'package.json'))) {
      return saved;
    }

    // 2. 环境变量配置
    if (process.env.SHORTVIDEO_PROJECT_DIR && fs.existsSync(path.join(process.env.SHORTVIDEO_PROJECT_DIR, 'package.json'))) {
      return process.env.SHORTVIDEO_PROJECT_DIR;
    }

    // 3. 动态探测开发环境（从当前进程工作目录或上下文向上递归寻找包含 package.json 的工程根目录）
    const candidateDirs = [
      process.cwd(),
      __dirname,
      path.resolve(__dirname, '..'),
      path.resolve(__dirname, '..', '..'),
    ];

    for (const startDir of candidateDirs) {
      if (!startDir || startDir.includes('.asar')) continue;
      let cur = path.resolve(startDir);
      // 最多向上递归 4 层寻找含有 package.json 的工程根目录
      for (let i = 0; i < 4; i++) {
        if (!cur.includes('.asar') && fs.existsSync(path.join(cur, 'package.json'))) {
          return cur;
        }
        const parent = path.dirname(cur);
        if (parent === cur) break;
        cur = parent;
      }
    }

    // 4. 打包安装环境未找到源码工程时，返回可执行程序所在物理目录
    const exeDir = path.dirname(process.execPath);
    return exeDir && !exeDir.includes('.asar') ? exeDir : app.getPath('userData');
  }

  /**
   * 构建 Windows / Mac 强健的 PATH 环境变量（确保在 GUI 环境中也能找到 node）
   */
  private getEnhancedEnv(): NodeJS.ProcessEnv {
    const env: Record<string, string | undefined> = {
      ...process.env,
      FORCE_COLOR: '1',
      NODE_ENV: 'production',
    };

    const extraPaths: string[] = [];

    // 动态探测并注入 Remotion 在 Windows/Mac/Linux 各平台的 compositor 原生二进制目录 (包含 ffmpeg, ffprobe)
    const procResources = process.resourcesPath || '';
    const remotionBaseDirs = [
      path.join(procResources, 'app.asar.unpacked', 'node_modules', '@remotion'),
      path.join(__dirname, '..', 'node_modules', '@remotion'),
      path.join(process.cwd(), 'node_modules', '@remotion'),
    ];

    for (const baseDir of remotionBaseDirs) {
      if (fs.existsSync(baseDir)) {
        try {
          const entries = fs.readdirSync(baseDir);
          for (const entry of entries) {
            if (entry.startsWith('compositor-')) {
              extraPaths.push(path.join(baseDir, entry));
            }
          }
        } catch {}
      }
    }

    if (process.platform === 'win32') {
      if (process.env.ProgramFiles) extraPaths.push(path.join(process.env.ProgramFiles, 'nodejs'));
      if (process.env['ProgramFiles(x86)']) extraPaths.push(path.join(process.env['ProgramFiles(x86)'], 'nodejs'));
      extraPaths.push('C:\\Program Files\\nodejs', 'C:\\Program Files (x86)\\nodejs', path.dirname(process.execPath));
    } else {
      // macOS / Linux 关键二进制及 Homebrew 路径
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      extraPaths.push(
        // Homebrew (Apple Silicon)
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        // Homebrew (Intel Mac)
        '/usr/local/bin',
        '/usr/local/sbin',
        // Linux 标准路径
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        path.dirname(process.execPath),
      );
      // nvm (Node Version Manager) - 最常用的 Node 管理工具
      if (homeDir) {
        const nvmDefault = path.join(homeDir, '.nvm', 'versions', 'node');
        if (fs.existsSync(nvmDefault)) {
          try {
            const nodeVersions = fs.readdirSync(nvmDefault).sort().reverse();
            for (const v of nodeVersions.slice(0, 3)) {
              extraPaths.push(path.join(nvmDefault, v, 'bin'));
            }
          } catch {}
        }
        // fnm (Fast Node Manager)
        const fnmDir = process.env.FNM_DIR || path.join(homeDir, '.fnm');
        const fnmDefault = path.join(fnmDir, 'node-versions');
        if (fs.existsSync(fnmDefault)) {
          try {
            const nodeVersions = fs.readdirSync(fnmDefault).sort().reverse();
            for (const v of nodeVersions.slice(0, 3)) {
              extraPaths.push(path.join(fnmDefault, v, 'installation', 'bin'));
            }
          } catch {}
        }
        // volta
        extraPaths.push(path.join(homeDir, '.volta', 'bin'));
        // n (Node version manager)
        extraPaths.push('/usr/local/n/versions/node');
      }
    }

    const currentPath = env.PATH || env.Path || '';
    const delimiter = path.delimiter;
    const combined = Array.from(new Set([...extraPaths, ...currentPath.split(delimiter)]))
      .filter(Boolean)
      .join(delimiter);
    env.PATH = combined;
    env.Path = combined;
    return env as NodeJS.ProcessEnv;
  }

  /**
   * 查找编译后的渲染脚本 JS 路径（支持开发环境与已安装客户端双路径）
   * 彻底摆脱 pnpm / package.json 依赖，直接用 node 执行打包后的 JS
   */
  private resolveRenderScriptPath(): string {
    const candidates = [
      // 安装包环境：asar 解包后 resources 目录
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'dist-electron', 'scripts', 'scripts', 'CompareEnglishWord.js'),
      path.join(process.resourcesPath || '', 'dist-electron', 'scripts', 'scripts', 'CompareEnglishWord.js'),
      // 开发环境：tsc 输出 dist-electron/scripts/scripts/CompareEnglishWord.js
      path.join(__dirname, '..', 'dist-electron', 'scripts', 'scripts', 'CompareEnglishWord.js'),
      path.join(__dirname, 'scripts', 'scripts', 'CompareEnglishWord.js'),
      path.join(app.getAppPath(), 'dist-electron', 'scripts', 'scripts', 'CompareEnglishWord.js'),
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }

  /**
   * 启动视频渲染任务（直接用 node 执行编译后的 JS，无需 pnpm / package.json）
   */
  public async startRender(): Promise<{ success: boolean; message?: string }> {
    if (this.currentProcess && this.status === 'running') {
      return { success: false, message: '视频渲染任务已在运行中，请勿重复启动' };
    }

    const renderScript = this.resolveRenderScriptPath();
    const scriptExists = fs.existsSync(renderScript);

    // 前置校验：脚本不存在时提前返回，不设置 running 状态
    if (!scriptExists) {
      this.appendLog('error', `❌ 未找到编译后的渲染脚本: ${renderScript}`);
      this.appendLog('error', `💡 解决办法: 请重新构建客户端安装包 (pnpm run electron:dist)。`);
      return { success: false, message: '渲染脚本不存在，请重新构建客户端' };
    }

    this.status = 'running';
    this.startTime = Date.now();
    this.endTime = null;
    this.exitCode = null;

    const appVersion = app.getVersion();
    const appTag = appVersion.startsWith('v') ? appVersion : `v${appVersion}`;
    this.appendLog('system', `🚀 准备执行视频渲染任务: node CompareEnglishWord.js`);
    this.appendLog('system', `🏷️ 软件版本: ${appTag}`);
    this.appendLog('system', `📄 渲染脚本路径: ${renderScript}`);

    this.broadcast('render:status-update', this.getState());

    try {
      // 动态获取当前登录用户 Token（通过 Token 进行接口鉴权与服务端代理上传）
      let authToken = '';
      try {
        const { windowManager, WindowManager } = require('./window-manager');
        const wm = windowManager || (typeof WindowManager?.getInstance === 'function' ? WindowManager.getInstance() : null);
        if (wm) {
          authToken = await wm.getMainAuthToken();
        }
      } catch (err: any) {
        console.warn('[RenderManager] 获取用户会话凭据失败:', err?.message || err);
      }

      // 直接用 node 执行编译后 JS，BundledCodeCache 存放在 userData 目录下持久化复用
      const userDataDir = app.getPath('userData');
      const defaultOutputDir = path.join(userDataDir, 'out');
      const workingDir = this.resolvePhysicalWorkingDir();
      const targetApiUrl = APP_CONFIG.siteUrl || APP_CONFIG.productionUrl || 'https://app.shortvideo.ca';
      
      this.appendLog('system', `🌐 目标渲染接口地址: ${targetApiUrl}`);
      this.appendLog('system', `📁 物理工作目录: ${workingDir}`);
      this.appendLog('system', `💾 视频输出目录: ${defaultOutputDir}`);
      if (!authToken) {
        this.status = 'idle';
        this.appendLog('stderr', `❌ [登录拦截] 检测到当前尚未登录用户账号，已取消启动视频渲染！`);
        this.appendLog('system', `💡 提示: 请先切换到【ShortVideo 主站】标签页登录您的账号，登录成功后回到此页面点击【开始渲染】即可。`);
        this.broadcast('render:status-update', this.getState());
        return { success: false, message: '未检测到登录凭据，请先在主站登录账号后再执行渲染' };
      }

      const masked = authToken.length > 12 ? `${authToken.slice(0, 6)}...${authToken.slice(-6)}` : '***';
      this.appendLog('system', `🔑 已成功捕获当前登录用户会话凭据 (${masked})，已注入渲染安全进程`);

      let currentLang = 'zh';
      try {
        const { windowManager, WindowManager } = require('./window-manager');
        const wm = windowManager || (typeof WindowManager?.getInstance === 'function' ? WindowManager.getInstance() : null);
        if (wm?.getCurrentLanguage) {
          currentLang = wm.getCurrentLanguage();
        }
      } catch {}

      const spawnArgs = [
        renderScript,
        `--url=${targetApiUrl}`,
        `--token=${authToken}`,
        `--client=electron`,
        `--scope=current_user`,
        `--lang=${currentLang}`,
      ];

      this.currentProcess = spawn(process.execPath, spawnArgs, {
        cwd: workingDir,
        shell: false,
        detached: process.platform !== 'win32',
        env: {
          ...this.getEnhancedEnv(),
          ELECTRON_RUN_AS_NODE: '1',
          SHORTVIDEO_API_BASE: targetApiUrl,
          NEXT_PUBLIC_SITE_ORIGIN: targetApiUrl,
          SHORTVIDEO_ROOT_DIR: workingDir,
          SHORTVIDEO_CLIENT_MODE: 'electron',
          SHORTVIDEO_CLIENT_SCOPE: 'current_user',
          SHORTVIDEO_LANG: currentLang,
          // 明确告知渲染脚本将生成的视频文件存放在应用程序数据目录（userData/out）
          SHORTVIDEO_OUTPUT_DIR: defaultOutputDir,
          // 告知渲染脚本把 BundledCodeCache 存到 userData 而非源码目录
          REMOTION_BUNDLE_CACHE_DIR: path.join(userDataDir, 'BundledCodeCache', 'CompareEnglishWord'),
          ...(authToken ? { SHORTVIDEO_AUTH_TOKEN: authToken } : {}),
        },
      });

      const child = this.currentProcess;

      const handleData = (type: 'stdout' | 'stderr', chunk: Buffer) => {
        const str = chunk.toString('utf-8');
        const lines = str.split(/\r\n|\n|\r/);
        for (const rawLine of lines) {
          const line = rawLine.replace(/^\r+|\r+$/g, '');
          if (line.trim().length > 0) {
            this.appendLog(type, line);
          }
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => handleData('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => handleData('stderr', chunk));

      child.on('error', (err: any) => {
        this.status = 'error';
        this.endTime = Date.now();
        this.appendLog('error', `❌ 渲染子进程启动异常: ${err.message}`);
        this.currentProcess = null;
        this.broadcast('render:status-update', this.getState());
      });

      child.on('close', (code: number | null) => {
        this.endTime = Date.now();
        this.exitCode = code;
        this.currentProcess = null;

        if (code === 0) {
          this.status = 'success';
          this.appendLog('success', `🎉 视频渲染任务执行完毕！(退出代码: 0, 耗时: ${Math.round((this.endTime - (this.startTime || 0)) / 1000)}s)`);
        } else {
          this.status = 'error';
          this.appendLog('error', `⚠️ 视频渲染任务异常退出 (退出代码: ${code})`);
        }

        this.broadcast('render:status-update', this.getState());
      });

      return { success: true };
    } catch (e: any) {
      this.status = 'error';
      this.endTime = Date.now();
      this.appendLog('error', `❌ 启动渲染任务失败: ${e.message}`);
      this.broadcast('render:status-update', this.getState());
      return { success: false, message: e.message };
    }
  }

  /**
   * 终止当前正在运行的渲染任务
   */
  public stopRender(): { success: boolean; message?: string } {
    if (!this.currentProcess || this.status !== 'running') {
      return { success: false, message: '当前没有正在运行的渲染任务' };
    }

    const pid = this.currentProcess.pid;
    this.appendLog('system', `🛑 正在终止视频渲染进程 (PID: ${pid})...`);

    try {
      if (process.platform === 'win32' && pid) {
        // Windows 强制终止整个进程树
        spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], { windowsHide: true });
      } else if (pid) {
        // macOS / Linux: 先发 SIGTERM 优雅关闭，2 秒内未退出再强制 SIGKILL
        const procRef = this.currentProcess;
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          // 非进程组长时兜底单进程 SIGTERM
          try { procRef?.kill('SIGTERM'); } catch {}
        }
        setTimeout(() => {
          if (procRef && !procRef.killed) {
            try { process.kill(-pid, 'SIGKILL'); } catch {}
            try { procRef.kill('SIGKILL'); } catch {}
          }
        }, 2000);
      }

      this.status = 'idle';
      this.endTime = Date.now();
      this.currentProcess = null;
      this.appendLog('system', `⏹️ 视频渲染任务已由用户手动终止`);
      this.broadcast('render:status-update', this.getState());
      return { success: true };
    } catch (err: any) {
      this.appendLog('error', `终止进程失败: ${err.message}`);
      return { success: false, message: err.message };
    }
  }
}

export const renderManager = RenderManager.getInstance();
