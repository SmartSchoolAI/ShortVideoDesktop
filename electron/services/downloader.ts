import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import os from 'os';
import { app } from 'electron';
import { APP_CONFIG } from '../config';
import { isSafeVideoDownloadUrl } from '../utils/url-safety';

export { isSafeVideoDownloadUrl };

export type DownloadProgressCallback = (downloadedBytes: number, totalBytes: number, percentText: string) => void;

// 按规范化缓存文件路径去重并发下载，避免多任务写同一路径竞争覆盖
const inFlightDownloads = new Map<string, Promise<string>>();
let hasPrunedStaleTempFiles = false;

function pruneStaleTempFiles(cacheDir: string): void {
  if (hasPrunedStaleTempFiles) return;
  hasPrunedStaleTempFiles = true;
  try {
    const cutoffMs = Date.now() - 2 * 60 * 60 * 1000;
    for (const ent of fs.readdirSync(cacheDir, { withFileTypes: true })) {
      if (!ent.isFile() || !ent.name.endsWith('.tmp')) continue;
      const fullPath = path.join(cacheDir, ent.name);
      try {
        const st = fs.statSync(fullPath);
        if (st.mtimeMs < cutoffMs) {
          fs.unlinkSync(fullPath);
        }
      } catch { }
    }
  } catch { }
}


/**
 * 校验本地缓存的文件是否为有效的二进制视频（防止服务器返回404的HTML错误页）
 */
export function isValidVideoFile(filePath: string): boolean {
  try {
    if (!filePath || typeof filePath !== 'string' || !fs.existsSync(filePath)) return false;
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < 10240) return false;

    // 读取前 256 字节检查魔数与文件特征，使用 try/finally 确保异常时必定释放 fd
    const uint8Buf = new Uint8Array(256);
    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, uint8Buf, 0, 256, 0);
    } finally {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch { }
      }
    }

    const buffer = Buffer.from(uint8Buf);

    const headStr = buffer.toString('utf8').trimStart().toLowerCase();
    if (
      headStr.startsWith('<!doctype') ||
      headStr.startsWith('<html') ||
      headStr.startsWith('<head') ||
      headStr.startsWith('<?xml') ||
      headStr.startsWith('<error') ||
      headStr.startsWith('<svg') ||
      headStr.startsWith('{')
    ) {
      return false;
    }

    // 检查常见的视频格式特征 (ftyp for mp4/mov, webm/mkv, avi/riff, flv)
    const isMp4 = buffer.includes(Buffer.from('ftyp', 'ascii'));
    const isWebm = buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
    const isAvi = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'AVI ';
    const isFlv = buffer.slice(0, 3).toString('ascii') === 'FLV' && buffer[3] === 0x01;
    return isMp4 || isWebm || isAvi || isFlv || stats.size > 102400; // 兜底：若大于100KB且非HTML/XML/JSON错误包则放行
  } catch {
    return false;
  }
}

/**
 * 智能探测本地渲染输出目录中是否已有匹配视频（优先本地复用，0延迟且杜绝404）
 */
export function findExistingLocalVideo(inputPathOrUrl: string): string | null {
  try {
    if (!inputPathOrUrl || typeof inputPathOrUrl !== 'string' || inputPathOrUrl.includes('\0')) {
      return null;
    }
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
    const baseName = path.basename(clean, ext); // e.g. "deadline-timeline_ja"
    const reqLangMatch = baseName.match(/_([a-z]{2,5})$/i);
    const reqLangSuffix = reqLangMatch ? reqLangMatch[1].toLowerCase() : null;
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
          // 1. 优先精确匹配（文件名与语言后缀完全一致）
          for (const ent of entries) {
            if (!ent.isDirectory() && ent.name.toLowerCase().endsWith(ext.toLowerCase())) {
              const nameWithoutExt = path.basename(ent.name, ext);
              if (nameWithoutExt.toLowerCase() === baseName.toLowerCase()) {
                const full = path.join(dir, ent.name);
                if (!folderSegment || dir.split(/[\\/]/).includes(folderSegment)) {
                  return full;
                }
              }
            }
          }
          // 2. 次选：当目标未显式包含语言后缀时才允许模糊匹配；若请求携带语言后缀则严格禁止匹配任意异语种文件
          for (const ent of entries) {
            if (!ent.isDirectory() && ent.name.toLowerCase().endsWith(ext.toLowerCase())) {
              const nameWithoutExt = path.basename(ent.name, ext);
              const candLangMatch = nameWithoutExt.match(/_([a-z]{2,5})$/i);
              const candLangSuffix = candLangMatch ? candLangMatch[1].toLowerCase() : null;
              const nameRaw = nameWithoutExt.replace(/_[a-z]{2,5}$/i, '');
              if (nameRaw === rawBaseName) {
                if (reqLangSuffix && candLangSuffix && candLangSuffix !== reqLangSuffix) {
                  continue;
                }
                if (reqLangSuffix && !candLangSuffix) {
                  continue;
                }
                const full = path.join(dir, ent.name);
                if (!folderSegment || dir.split(/[\\/]/).includes(folderSegment)) {
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
function safeUnlink(filePath: string): void {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch { }
}

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

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return reject(new Error(`不支持的视频下载协议: ${parsedUrl.protocol}`));
      }
      if (!isSafeVideoDownloadUrl(parsedUrl)) {
        return reject(new Error(`拒绝访问不安全的内部网络地址: ${parsedUrl.hostname}`));
      }
    } catch {
      return reject(new Error(`无效的视频下载 URL: ${url}`));
    }

    const MAX_VIDEO_BYTES = 512 * 1024 * 1024; // 512 MB upper bound
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    let settled = false;
    let activeFileStream: fs.WriteStream | null = null;
    let activeRes: http.IncomingMessage | null = null;
    const failAndCleanup = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        activeRes?.destroy();
      } catch { }
      try {
        activeFileStream?.destroy();
      } catch { }
      safeUnlink(tempPath);
      reject(err);
    };

    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.get(parsedUrl.toString(), (res) => {
      activeRes = res;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let nextUrl: string;
        try {
          const resolved = new URL(res.headers.location, parsedUrl);
          if (parsedUrl.protocol === 'https:' && resolved.protocol !== 'https:') {
            settled = true;
            safeUnlink(tempPath);
            return reject(new Error(`拒绝不安全的 HTTPS 降级重定向: ${resolved.origin}`));
          }
          if (!isSafeVideoDownloadUrl(resolved)) {
            settled = true;
            safeUnlink(tempPath);
            return reject(new Error(`非法或受限的重定向目标: ${resolved.origin}`));
          }
          nextUrl = resolved.toString();
        } catch {
          settled = true;
          safeUnlink(tempPath);
          return reject(new Error(`无效的重定向地址: ${res.headers.location}`));
        }
        settled = true;
        safeUnlink(tempPath);
        downloadFileStream(nextUrl, targetPath, onProgress, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        settled = true;
        safeUnlink(tempPath);
        reject(new Error(`下载视频失败，HTTP 状态码: ${res.statusCode} (${url})`));
        return;
      }

      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      if (
        contentType &&
        (contentType.includes('text/html') ||
          contentType.includes('application/json') ||
          contentType.includes('text/plain') ||
          contentType.includes('text/xml') ||
          contentType.includes('application/xml') ||
          contentType.includes('image/svg+xml'))
      ) {
        res.resume();
        settled = true;
        safeUnlink(tempPath);
        reject(new Error(`下载视频失败，远程返回非视频响应类型: ${contentType}`));
        return;
      }

      const declaredTotal = parseInt(res.headers['content-length'] || '0', 10);
      if (Number.isFinite(declaredTotal) && declaredTotal > MAX_VIDEO_BYTES) {
        res.destroy();
        settled = true;
        safeUnlink(tempPath);
        reject(new Error(`远程视频体积超过允许上限 (${Math.round(declaredTotal / 1024 / 1024)}MB > 512MB)`));
        return;
      }

      const fileStream = fs.createWriteStream(tempPath);
      activeFileStream = fileStream;
      const totalBytes = Number.isFinite(declaredTotal) ? declaredTotal : 0;
      let downloadedBytes = 0;

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes > MAX_VIDEO_BYTES) {
          failAndCleanup(new Error('远程视频流超出最大体积限制 (512MB)'));
          return;
        }
        if (totalBytes > 0) {
          const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
          onProgress?.(downloadedBytes, totalBytes, `${pct}%`);
        } else {
          const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
          onProgress?.(downloadedBytes, 0, `${mb}MB`);
        }
      });

      res.on('error', (err) => {
        failAndCleanup(err instanceof Error ? err : new Error(String(err)));
      });

      res.on('aborted', () => {
        failAndCleanup(new Error('远程视频响应流意外中断'));
      });

      fileStream.on('error', (err) => {
        res.destroy();
        failAndCleanup(err instanceof Error ? err : new Error(String(err)));
      });

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => {
          if (settled) return;
          if (!res.complete) {
            failAndCleanup(new Error('远程视频 HTTP 响应未完整结束（连接可能被提前关闭）'));
            return;
          }
          if (!isValidVideoFile(tempPath)) {
            failAndCleanup(new Error('下载的文件非有效视频流（可能是远程返回了404错误网页）'));
            return;
          }
          try {
            if (isValidVideoFile(targetPath)) {
              safeUnlink(tempPath);
            } else {
              fs.renameSync(tempPath, targetPath);
            }
          } catch (renameErr: any) {
            if (!isValidVideoFile(targetPath)) {
              failAndCleanup(renameErr instanceof Error ? renameErr : new Error(String(renameErr)));
              return;
            }
            safeUnlink(tempPath);
          }
          settled = true;
          onProgress?.(downloadedBytes, totalBytes || downloadedBytes, '100%');
          resolve(targetPath);
        });
      });
    });

    req.on('error', (err) => {
      failAndCleanup(err instanceof Error ? err : new Error(String(err)));
    });

    req.setTimeout(90000, () => {
      req.destroy();
      failAndCleanup(new Error('下载视频文件超时 (90s)'));
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
  if (!videoUrlOrPath || typeof videoUrlOrPath !== 'string' || /[\x00-\x1f\x7f]/.test(videoUrlOrPath)) {
    throw new Error('视频资源路径无效或不能为空');
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
    } else {
      pruneStaleTempFiles(cacheDir);
    }

    // 根据 URL 生成候选 URL 列表（支持远程多语言后缀智能降级）
    const candidateUrls: string[] = [fullUrl];

    try {
      const urlObj = new URL(fullUrl);
      const cleanPath = urlObj.pathname.split('?')[0];
      const ext = path.extname(cleanPath) || '.mp4';
      const baseName = path.basename(cleanPath, ext);
      const rawBase = baseName.replace(/_[a-z]{2,5}$/i, '');
      const fullSuffix = `${baseName}${ext}`;
      const pathPrefix = cleanPath.endsWith(fullSuffix)
        ? cleanPath.slice(0, cleanPath.length - fullSuffix.length)
        : cleanPath.slice(0, Math.max(0, cleanPath.lastIndexOf('/') + 1));

      // 若原 URL 带有语言后缀（如 flat-studio_en.mp4），将去除后缀的无后缀根文件加入备选
      if (/_[a-z]{2,5}$/i.test(baseName)) {
        const rootPath = `${pathPrefix}${rawBase}${ext}`;
        const rootUrl = `${urlObj.origin}${rootPath}${urlObj.search}`;
        if (!candidateUrls.includes(rootUrl)) {
          candidateUrls.push(rootUrl);
        }
      } else {
        // 若原 URL 不带语言后缀，优先追加 _zh 与 _en 备选项（针对多语言双版本视频架构）
        const zhPath = `${pathPrefix}${baseName}_zh${ext}`;
        const zhUrl = `${urlObj.origin}${zhPath}${urlObj.search}`;
        if (!candidateUrls.includes(zhUrl)) {
          candidateUrls.push(zhUrl);
        }
        const enPath = `${pathPrefix}${baseName}_en${ext}`;
        const enUrl = `${urlObj.origin}${enPath}${urlObj.search}`;
        if (!candidateUrls.includes(enUrl)) {
          candidateUrls.push(enUrl);
        }
      }
    } catch (_) { }

    let lastError: any = null;

    for (let i = 0; i < candidateUrls.length; i++) {
      const currentUrl = candidateUrls[i];
      const urlObj = new URL(currentUrl);
      const cleanPath = urlObj.pathname.split('?')[0];
      const ext = path.extname(cleanPath) || '.mp4';
      const baseName = path.basename(cleanPath, ext).replace(/[^a-zA-Z0-9_\-]/g, '_') || 'video';
      const urlHash = crypto.createHash('sha256').update(`${urlObj.origin}${urlObj.pathname}`).digest('hex').slice(0, 10);
      const targetPath = path.join(cacheDir, `${baseName}_${urlHash}${ext}`);

      // 如果缓存已有且合法，直接复用
      if (isValidVideoFile(targetPath)) {
        const stats = fs.statSync(targetPath);
        onProgress?.(stats.size, stats.size, '100%');
        return targetPath;
      }

      try {
        if (i > 0) {
          console.log(`[Downloader] 🔄 带有语言后缀的版本不存在，正在尝试根主视频地址: ${currentUrl}`);
        }
        let pending = inFlightDownloads.get(targetPath);
        if (!pending) {
          pending = downloadFileStream(currentUrl, targetPath, onProgress).finally(() => {
            if (inFlightDownloads.get(targetPath) === pending) {
              inFlightDownloads.delete(targetPath);
            }
          });
          inFlightDownloads.set(targetPath, pending);
        }
        const downloadedPath = await pending;
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

