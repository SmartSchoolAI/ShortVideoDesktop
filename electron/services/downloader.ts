import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import os from 'os';
import { app } from 'electron';
import { APP_CONFIG } from '../config';

export type DownloadProgressCallback = (downloadedBytes: number, totalBytes: number, percentText: string) => void;

// 14 种受支持的核心语言代码
const CORE_LANG_SUFFIXES = ['en', 'zh', 'ja', 'ko', 'vi', 'th', 'id', 'es', 'fr', 'pt', 'de', 'it', 'ru', 'tr'];

/**
 * 校验本地缓存的文件是否为有效的二进制视频（防止服务器返回404的HTML错误页）
 */
function isValidVideoFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (stats.size < 10240) return false;

    // 读取前 256 字节检查魔数与文件特征
    const uint8Buf = new Uint8Array(256);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, uint8Buf, 0, 256, 0);
    fs.closeSync(fd);

    const buffer = Buffer.from(uint8Buf);

    const headStr = buffer.toString('utf8').toLowerCase();
    if (headStr.includes('<!doctype') || headStr.includes('<html') || headStr.includes('<head')) {
      return false;
    }

    // 检查常见的视频格式特征 (ftyp for mp4/mov, or webm/mkv)
    const isMp4 = buffer.includes(Buffer.from('ftyp', 'ascii'));
    const isWebm = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    return isMp4 || isWebm || stats.size > 102400; // 兜底：若大于100KB且非HTML则放行
  } catch {
    return false;
  }
}

/**
 * 智能探测本地渲染输出目录中是否已有匹配视频（优先本地复用，0延迟且杜绝404）
 */
export function findExistingLocalVideo(inputPathOrUrl: string): string | null {
  try {
    if (fs.existsSync(inputPathOrUrl) && isValidVideoFile(inputPathOrUrl)) {
      return inputPathOrUrl;
    }

    let clean = inputPathOrUrl;
    try {
      if (clean.includes('://')) {
        const u = new URL(clean);
        clean = decodeURIComponent(u.pathname);
      }
    } catch (_) { }

    clean = clean.replace(/\\/g, '/');
    const ext = path.extname(clean) || '.mp4';
    const baseName = path.basename(clean, ext); // e.g. "deadline-timeline"
    const rawBaseName = baseName.replace(/_[a-z]{2,5}$/i, '');

    const segments = clean.split('/').filter(Boolean);
    const folderSegment = segments.length >= 2 ? segments[segments.length - 2] : '';

    const searchRoots = [
      path.join(app.getPath('userData'), 'out'),
      path.join(app.getPath('appData'), 'shortvideo', 'out'),
      path.join(app.getPath('appData'), 'ShortVideo', 'out'),
      path.join(os.homedir(), 'shortvideo', 'out'),
      path.resolve('out'),
    ];

    for (const root of searchRoots) {
      if (!fs.existsSync(root)) continue;

      const searchDir = (dir: string, depth = 0): string | null => {
        if (depth > 5) return null;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          // 1. 先查找匹配的文件
          for (const ent of entries) {
            if (!ent.isDirectory() && ent.name.toLowerCase().endsWith(ext.toLowerCase())) {
              const nameWithoutExt = path.basename(ent.name, ext);
              const nameRaw = nameWithoutExt.replace(/_[a-z]{2,5}$/i, '');
              if (nameRaw === rawBaseName) {
                const full = path.join(dir, ent.name);
                if (!folderSegment || dir.includes(folderSegment) || full.includes(folderSegment)) {
                  return full;
                }
              }
            }
          }
          // 2. 递归查找子文件夹
          for (const ent of entries) {
            if (ent.isDirectory()) {
              const res = searchDir(path.join(dir, ent.name), depth + 1);
              if (res) return res;
            }
          }
        } catch (_) { }
        return null;
      };

      const found = searchDir(root);
      if (found && isValidVideoFile(found)) {
        return found;
      }
    }
  } catch (e) {
    console.warn('[Downloader] 本地磁盘视频探测异常:', e);
  }
  return null;
}

/**
 * 执行单次 HTTP/HTTPS 视频文件流下载
 */
function downloadFileStream(
  url: string,
  targetPath: string,
  onProgress?: DownloadProgressCallback,
  redirectCount = 0
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('下载视频重定向次数过多，已终止'));
    }

    const fileStream = fs.createWriteStream(targetPath);
    const client = url.startsWith('https://') ? https : http;

    const req = client.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fileStream.close();
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        downloadFileStream(res.headers.location, targetPath, onProgress, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        fileStream.close();
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        reject(new Error(`下载视频失败，HTTP 状态码: ${res.statusCode} (${url})`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0) {
          const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          onProgress?.(downloadedBytes, totalBytes, `${pct}%`);
        } else {
          const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
          onProgress?.(downloadedBytes, 0, `${mb}MB`);
        }
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        if (!isValidVideoFile(targetPath)) {
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          reject(new Error('下载的文件非有效视频流（可能是远程返回了404错误网页）'));
          return;
        }
        onProgress?.(downloadedBytes, totalBytes || downloadedBytes, '100%');
        resolve(targetPath);
      });
    });

    req.on('error', (err) => {
      fileStream.close();
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      reject(err);
    });

    req.setTimeout(90000, () => {
      req.destroy();
      fileStream.close();
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      reject(new Error('下载视频文件超时 (90s)'));
    });
  });
}

/**
 * 确保将远程视频资源下载至本地临时缓存，返回本地绝对路径
 * 特性：
 * 1. 优先秒级复用本地渲染输出目录现成文件（免网络下载）
 * 2. 具备远程多语言后缀智能探测（当原始 .mp4 404 时自动重试 _en.mp4, _zh.mp4 等候选）
 */
export async function ensureLocalVideoFile(
  videoUrlOrPath: string,
  onProgress?: DownloadProgressCallback
): Promise<string> {
  if (!videoUrlOrPath) {
    throw new Error('视频资源路径不能为空');
  }

  // 1. 如果本身就是合法的本地绝对文件路径且已存在
  if (fs.existsSync(videoUrlOrPath) && isValidVideoFile(videoUrlOrPath)) {
    return videoUrlOrPath;
  }

  // 2. 优先在本地渲染输出目录进行智能匹配
  const localMatch = findExistingLocalVideo(videoUrlOrPath);
  if (localMatch) {
    console.log(`[Downloader] ⚡ 在本地渲染输出目录命中视频: ${localMatch}，免去网络下载`);
    const stats = fs.statSync(localMatch);
    onProgress?.(stats.size, stats.size, '100%');
    return localMatch;
  }

  // 若明确是本地磁盘绝对路径但文件不存在，抛出明确错误
  const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(videoUrlOrPath) || videoUrlOrPath.startsWith('\\\\');
  const isPosixAbsolute = process.platform !== 'win32' && videoUrlOrPath.startsWith('/') && !videoUrlOrPath.startsWith('//');
  if (isWindowsAbsolute || isPosixAbsolute) {
    throw new Error(`本地视频文件不存在: ${videoUrlOrPath}`);
  }

  // 3. 如果是相对 URL 路径，自动拼接下载基准域名
  let fullUrl = videoUrlOrPath;
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    const downloadOrigin =
      process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ||
      process.env.DOWNLOAD_BASE_URL ||
      process.env.NEXT_PUBLIC_SITE_ORIGIN ||
      APP_CONFIG.downloadUrl ||
      APP_CONFIG.siteUrl ||
      '';
    if (downloadOrigin) {
      fullUrl = `${downloadOrigin.replace(/\/+$/, '')}/${videoUrlOrPath.replace(/^\/+/, '')}`;
    }
  }

  // 4. 执行网络下载并写入本地缓存
  if (fullUrl.startsWith('http://') || fullUrl.startsWith('https://')) {
    const cacheDir = path.join(app.getPath('userData'), 'cached_videos');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // 根据 URL 生成候选 URL 列表（支持远程多语言后缀智能降级）
    const candidateUrls: string[] = [fullUrl];

    try {
      const urlObj = new URL(fullUrl);
      const cleanPath = urlObj.pathname.split('?')[0];
      const ext = path.extname(cleanPath) || '.mp4';
      const baseName = path.basename(cleanPath, ext);
      const hasLangSuffix = /_[a-z]{2,5}$/i.test(baseName);

      if (!hasLangSuffix) {
        // 如果原 URL 未带语言后缀（如 deadline-timeline.mp4），加入 _en, _zh 以及其他语言候选
        const rawBase = baseName;
        for (const lang of CORE_LANG_SUFFIXES) {
          const candPath = cleanPath.replace(new RegExp(`${rawBase}\\${ext}$`), `${rawBase}_${lang}${ext}`);
          const candUrl = `${urlObj.origin}${candPath}${urlObj.search}`;
          if (!candidateUrls.includes(candUrl)) {
            candidateUrls.push(candUrl);
          }
        }
      }
    } catch (_) { }

    let lastError: any = null;

    for (let i = 0; i < candidateUrls.length; i++) {
      const currentUrl = candidateUrls[i];
      const urlObj = new URL(currentUrl);
      const cleanPath = urlObj.pathname.split('?')[0];
      const ext = path.extname(cleanPath) || '.mp4';
      const baseName = path.basename(cleanPath, ext).replace(/[^a-zA-Z0-9_\-]/g, '_') || `video_${Date.now()}`;
      const targetPath = path.join(cacheDir, `${baseName}${ext}`);

      // 如果缓存已有且合法，直接复用
      if (isValidVideoFile(targetPath)) {
        const stats = fs.statSync(targetPath);
        onProgress?.(stats.size, stats.size, '100%');
        return targetPath;
      }

      try {
        if (i > 0) {
          console.log(`[Downloader] 🔄 正在尝试备选多语言远程视频地址: ${currentUrl}`);
        }
        const downloadedPath = await downloadFileStream(currentUrl, targetPath, onProgress);
        return downloadedPath;
      } catch (err: any) {
        lastError = err;
        // 如果是 404 或文件损坏，继续尝试下一个候选地址
        const is404 = err?.message?.includes('404') || err?.message?.includes('非有效视频流');
        if (is404 && i < candidateUrls.length - 1) {
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error(`无法下载视频资源: ${fullUrl}`);
  }

  throw new Error(`无法解析视频资源路径: ${videoUrlOrPath}`);
}

