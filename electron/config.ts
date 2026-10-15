import path from 'path';
import fs from 'fs';

// 桌面环境配置加载：
// 1. 本地开发环境：允许使用 .env 与 .env.desktop
// 2. 编译打包后的生产安装包：在任何条件下严禁加载 .env，仅允许加载公开安全的 .env.desktop
function loadDesktopEnv(): void {
  let isPackaged = false;
  try {
    const electron = require('electron');
    if (electron?.app?.isPackaged) {
      isPackaged = true;
    }
  } catch (_) {}

  if ((process as any).resourcesPath || __dirname.includes('.asar')) {
    isPackaged = true;
  }

  const candidates = isPackaged
    ? [
        path.resolve((process as any).resourcesPath || '', '.env.desktop'),
        path.resolve((process as any).resourcesPath || '', 'app.asar.unpacked', '.env.desktop'),
        path.resolve(process.cwd(), '.env.desktop'),
        path.resolve(__dirname, '../.env.desktop'),
      ].filter(Boolean)
    : [
        path.resolve(process.cwd(), '.env.desktop'),
        path.resolve(__dirname, '../.env.desktop'),
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '.env.local'),
        path.resolve(__dirname, '../.env'),
        path.resolve(__dirname, '../../.env'),
      ].filter(Boolean);

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex <= 0) continue;
          const key = trimmed.slice(0, eqIndex).trim();
          let value = trimmed.slice(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (key && !(key in process.env)) {
            process.env[key] = value;
          }
        }
      } catch (err) {
        console.warn(`[Config] 读取环境文件 ${envPath} 失败:`, err);
      }
      break;
    }
  }
}

loadDesktopEnv();

const defaultSiteOrigin =
  process.env.NEXT_PUBLIC_APP_SITE_URL ||
  process.env.NEXT_PUBLIC_SITE_ORIGIN ||
  'https://app.shortvideo.ca';

const defaultDownloadBaseUrl =
  process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ||
  process.env.DOWNLOAD_BASE_URL ||
  'https://download.shortvideo.ca';

export function getAppTagVersion(): string {
  if (process.env.APP_VERSION) {
    const v = process.env.APP_VERSION.trim();
    return v.startsWith('v') ? v : `v${v}`;
  }

  // 1. 优先尝试从 git tags 中读取当前发布 TAG 号
  try {
    const { execSync } = require('child_process');
    const gitTag = execSync('git describe --tags --abbrev=0', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    })?.trim();
    if (gitTag && /^v?\d+/.test(gitTag)) {
      return gitTag.startsWith('v') ? gitTag : `v${gitTag}`;
    }
  } catch {}

  // 2. 尝试从 package.json 中读取
  try {
    const candidates = [
      path.resolve(process.cwd(), 'package.json'),
      path.resolve(__dirname, '../package.json'),
      path.resolve(__dirname, '../../package.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg.version) return `v${pkg.version}`;
      }
    }
  } catch {}

  return 'v0.1.6';
}

export interface AppChannelInfo {
  channel: 'A' | 'B' | 'C';
  appName: string;
  appId: string;
}

/**
 * 动态识别当前实例属于 A、B、C 哪个独立版本
 * 支持环境变量、注入的 channel.json、package.json 元数据及进程文件名智能识别
 */
function getAppChannelInfo(): AppChannelInfo {
  // 1. 优先读取 process.env.SHORTVIDEO_CHANNEL
  const envChannel = (process.env.SHORTVIDEO_CHANNEL || '').trim().toUpperCase();
  if (['A', 'B', 'C'].includes(envChannel)) {
    return {
      channel: envChannel as 'A' | 'B' | 'C',
      appName: `ShortVideo ${envChannel}`,
      appId: `com.smartschoolai.shortvideo.${envChannel.toLowerCase()}`,
    };
  }

  // 2. 检查 channel.json (由 build-channel.js 编译/打包时注入)
  try {
    const candidates = [
      path.resolve(__dirname, 'channel.json'),
      path.resolve(__dirname, '../channel.json'),
      path.resolve((process as any).resourcesPath || '', 'channel.json'),
      path.resolve((process as any).resourcesPath || '', 'app.asar.unpacked', 'dist-electron', 'channel.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (raw && raw.channel && ['A', 'B', 'C'].includes(String(raw.channel).toUpperCase())) {
          const ch = String(raw.channel).toUpperCase() as 'A' | 'B' | 'C';
          return {
            channel: ch,
            appName: raw.appName || `ShortVideo ${ch}`,
            appId: raw.appId || `com.smartschoolai.shortvideo.${ch.toLowerCase()}`,
          };
        }
      }
    }
  } catch {}

  // 3. 检查 package.json 中 extraMetadata 注入的 channel
  try {
    const pkgCandidates = [
      path.resolve(process.cwd(), 'package.json'),
      path.resolve(__dirname, '../package.json'),
      path.resolve((process as any).resourcesPath || '', 'app.asar', 'package.json'),
    ];
    for (const p of pkgCandidates) {
      if (fs.existsSync(p)) {
        const pkg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (pkg.channel && ['A', 'B', 'C'].includes(String(pkg.channel).toUpperCase())) {
          const ch = String(pkg.channel).toUpperCase() as 'A' | 'B' | 'C';
          return {
            channel: ch,
            appName: pkg.productName || `ShortVideo ${ch}`,
            appId: pkg.appId || `com.smartschoolai.shortvideo.${ch.toLowerCase()}`,
          };
        }
      }
    }
  } catch {}

  // 4. 根据当前进程可执行文件名称智能推断 (如 ShortVideo-B.exe / ShortVideo B.exe)
  try {
    const execName = path.basename(process.execPath || '').toUpperCase();
    if (execName.includes('-B') || execName.includes(' B')) {
      return { channel: 'B', appName: 'ShortVideo B', appId: 'com.smartschoolai.shortvideo.b' };
    }
    if (execName.includes('-C') || execName.includes(' C')) {
      return { channel: 'C', appName: 'ShortVideo C', appId: 'com.smartschoolai.shortvideo.c' };
    }
  } catch {}

  // 5. 默认回退为 Channel A
  return {
    channel: 'A',
    appName: 'ShortVideo A',
    appId: 'com.smartschoolai.shortvideo.a',
  };
}

const currentChannel = getAppChannelInfo();

export const APP_CONFIG = {
  channel: currentChannel.channel,
  appName: currentChannel.appName,
  appId: currentChannel.appId,
  version: getAppTagVersion(),
  siteUrl: defaultSiteOrigin,
  productionUrl: defaultSiteOrigin,
  downloadUrl: defaultDownloadBaseUrl,
  platforms: {
    wechat: {
      name: '微信视频号',
      homeUrl: 'https://channels.weixin.qq.com/',
      publishUrl: 'https://channels.weixin.qq.com/platform/post/create',
      loginDetectionUrl: 'https://channels.weixin.qq.com/platform',
    },
    xiaohongshu: {
      name: '小红书',
      homeUrl: 'https://creator.xiaohongshu.com/new/home?source=official',
      publishUrl: 'https://creator.xiaohongshu.com/publish/publish?source=official',
      loginDetectionUrl: 'https://creator.xiaohongshu.com/',
    },
  },
  // 根据运行平台动态返回对应 UserAgent（必须与底层 OS 严格匹配，杜绝风控与 OAuth 检测）
  userAgent: (() => {
    const platform = process.platform;
    if (platform === 'darwin') {
      // macOS: 模拟 macOS Chrome
      return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    } else if (platform === 'linux') {
      // Linux: 模拟 X11 Linux Chrome
      return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }
    // Windows (win32): 标准 Windows Chrome
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  })(),
  window: {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
  },
};
