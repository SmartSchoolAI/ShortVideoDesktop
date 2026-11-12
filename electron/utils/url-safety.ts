import net from 'net';
import { APP_CONFIG } from '../config';

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (!net.isIP(clean)) return false;
  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const normalized = clean.startsWith('::ffff:') ? clean.slice(7) : clean;
  if (net.isIPv4(normalized)) return isPrivateOrLoopbackIp(normalized);
  if (clean === '::1' || clean === '::') return true;
  if (clean.startsWith('fe80:') || clean.startsWith('fc') || clean.startsWith('fd')) return true;
  return false;
}

export function getConfiguredSafeOrigins(): string[] {
  return [
    APP_CONFIG.siteUrl,
    APP_CONFIG.downloadUrl,
    process.env.NEXT_PUBLIC_APP_SITE_URL,
    process.env.NEXT_PUBLIC_SITE_ORIGIN,
    process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL,
    process.env.DOWNLOAD_BASE_URL,
  ]
    .filter((u): u is string => Boolean(u && typeof u === 'string'))
    .map((u) => {
      try {
        return new URL(u.trim()).origin;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}

export function isSafeHttpTargetUrl(input: string | URL): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = typeof input === 'string' ? new URL(input.trim()) : input;
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return false;
  }

  // 拒绝 URL 内嵌用户名/密码（防视觉欺骗及凭据泄露）
  if (parsedUrl.username || parsedUrl.password) {
    return false;
  }

  if (getConfiguredSafeOrigins().includes(parsedUrl.origin)) {
    return true;
  }

  const host = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  ) {
    return false;
  }

  if (net.isIP(host) && isPrivateOrLoopbackIp(host)) {
    return false;
  }

  return true;
}

export function isSafeVideoDownloadUrl(parsedUrl: URL): boolean {
  return isSafeHttpTargetUrl(parsedUrl);
}

