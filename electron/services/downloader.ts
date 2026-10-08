import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { app } from 'electron';
import { APP_CONFIG } from '../config';

export type DownloadProgressCallback = (downloadedBytes: number, totalBytes: number, percentText: string) => void;

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
 * 确保将远程视频资源下载至本地临时缓存，返回本地绝对路径
 */
export async function ensureLocalVideoFile(
  videoUrlOrPath: string,
  onProgress?: DownloadProgressCallback,
  redirectCount = 0
): Promise<string> {
  if (!videoUrlOrPath) {
    throw new Error('视频资源路径不能为空');
  }

  // 1. 如果本身就是合法的本地绝对文件路径且已存在
  if (fs.existsSync(videoUrlOrPath)) {
    return videoUrlOrPath;
  }

  // 若明确是本地磁盘绝对路径但文件不存在，直接抛出明确错误，杜绝误拼接到远程 URL
  const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(videoUrlOrPath) || videoUrlOrPath.startsWith('\\\\');
  const isPosixAbsolute = process.platform !== 'win32' && videoUrlOrPath.startsWith('/') && !videoUrlOrPath.startsWith('//');
  if (isWindowsAbsolute || isPosixAbsolute) {
    throw new Error(`本地视频文件不存在: ${videoUrlOrPath}`);
  }

  // 2. 如果是相对 URL 路径，自动拼接下载基准域名
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

  // 3. 执行网络下载并写入本地缓存
  if (fullUrl.startsWith('http://') || fullUrl.startsWith('https://')) {
    const cacheDir = path.join(app.getPath('userData'), 'cached_videos');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // 根据 URL 生成稳定的安全文件名
    const urlObj = new URL(fullUrl);
    const cleanPath = urlObj.pathname.split('?')[0];
    const ext = path.extname(cleanPath) || '.mp4';
    const baseName = path.basename(cleanPath, ext).replace(/[^a-zA-Z0-9_\-]/g, '_') || `video_${Date.now()}`;
    const targetPath = path.join(cacheDir, `${baseName}${ext}`);

    // 如果本地已有且校验通过，直接复用已下载文件
    if (isValidVideoFile(targetPath)) {
      const stats = fs.statSync(targetPath);
      onProgress?.(stats.size, stats.size, '100%');
      return targetPath;
    }

    // 限制重定向层级，防止循环
    if (redirectCount > 5) {
      throw new Error('下载视频重定向次数过多，已终止');
    }

    return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(targetPath);
      const client = fullUrl.startsWith('https://') ? https : http;

      const req = client.get(fullUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fileStream.close();
          ensureLocalVideoFile(res.headers.location, onProgress, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          fileStream.close();
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          reject(new Error(`下载视频失败，HTTP 状态码: ${res.statusCode} (${fullUrl})`));
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
          // 下载完成后进行视频合法性验证
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

  throw new Error(`无法解析视频资源路径: ${videoUrlOrPath}`);
}
