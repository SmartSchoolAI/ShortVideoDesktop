/**
 * 动态从系统环境变量读取 R2 配置
 */
function getR2EnvConfig() {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const bucketName = process.env.R2_BUCKET_NAME || 'shortvideo';

  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

/**
 * 统一获取 CDN 资源下载域名（优先环境变量，规避模块循环与 Node.js 环境兼容问题）
 */
export function getCdnBaseDomain(): string {
  const g = globalThis as any;
  const env = g?.__workerEnv || {};
  const raw = (
    env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ||
    env.DOWNLOAD_BASE_URL ||
    process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ||
    process.env.DOWNLOAD_BASE_URL ||
    ''
  );
  return String(raw).trim().replace(/\/+$/, '');
}

function getCdnBase(): string {
  return getCdnBaseDomain();
}

/** @deprecated 请使用 getCdnBase()，此常量仅为向后兼容保留 */
export const CDN_BASE_DOMAIN = process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL || process.env.DOWNLOAD_BASE_URL || '';

async function sha256Hex(data: any): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as any);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(key: any, data: any): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, dataBytes as any);
  return new Uint8Array(sig);
}

async function hmacSha256Hex(key: any, data: any): Promise<string> {
  const bytes = await hmacSha256(key, data);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 辅助方法：生成 AWS Signature Version 4 签名密钥 (Web Crypto 纯标准版)
 */
async function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Promise<Uint8Array> {
  const kDate = await hmacSha256('AWS4' + key, dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  return kSigning;
}

/**
 * 标准 AWS SigV4 RFC 3986 路径编码（保留路径分隔符 /）
 */
function encodeRfc3986Uri(str: string): string {
  return str
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');
}

/**
 * 上传 Buffer、Uint8Array 或字符串到 Cloudflare R2 (完全兼容 Edge Runtime)
 */
export async function uploadToR2(
  key: string,
  content: any,
  contentType: string = 'application/json'
): Promise<{ success: boolean; url: string; error?: string }> {
  try {
    const { accountId, accessKeyId, secretAccessKey, bucketName } = getR2EnvConfig();

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 credentials in environment variables.');
    }

    const cleanKey = key.replace(/^\/+/, '');
    const canonicalKey = encodeRfc3986Uri(cleanKey);
    const buffer: Uint8Array =
      typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content instanceof Uint8Array
        ? content
        : new Uint8Array(content);

    const host = `${accountId}.r2.cloudflarestorage.com`;
    const endpoint = `https://${host}/${bucketName}/${canonicalKey}`;
    const region = 'auto';
    const service = 's3';

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const payloadHash = await sha256Hex(buffer);

    const canonicalUri = `/${bucketName}/${canonicalKey}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'PUT',
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = await hmacSha256Hex(signingKey, stringToSign);

    const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        Host: host,
        'Content-Type': contentType,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authorizationHeader,
      },
      body: buffer as any,
    });

    const cdnBase = getCdnBase().replace(/\/+$/, '');
    const cleanUrl = cdnBase ? `${cdnBase}/${cleanKey}` : `/${cleanKey}`;

    if (!response.ok) {
      const errText = await response.text();
      console.error('[R2 Upload Error]', response.status, errText);
      return {
        success: false,
        url: cleanUrl,
        error: `HTTP ${response.status}: ${errText.substring(0, 300)}`,
      };
    }

    return {
      success: true,
      url: cleanUrl,
    };
  } catch (err: any) {
    console.error('[R2 Upload Exception]', err);
    const cdnBase = getCdnBase().replace(/\/+$/, '');
    const cleanK = String(key || '').replace(/^\/+/, '');
    return {
      success: false,
      url: cdnBase ? `${cdnBase}/${cleanK}` : `/${cleanK}`,
      error: err.message || 'Unknown R2 upload error',
    };
  }
}

/**
 * 从 Cloudflare R2 中彻底删除指定单个文件 (DeleteObject)
 */
export async function deleteFromR2(key: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { accountId, accessKeyId, secretAccessKey, bucketName } = getR2EnvConfig();
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing R2 credentials in environment variables.');
    }

    const cleanKey = String(key || '').replace(/^\/+/, '');
    if (!cleanKey) return { success: true };

    const canonicalKey = encodeRfc3986Uri(cleanKey);
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const endpoint = `https://${host}/${bucketName}/${canonicalKey}`;
    const region = 'auto';
    const service = 's3';

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    // 空请求体的 SHA256
    const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const canonicalUri = `/${bucketName}/${canonicalKey}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'DELETE',
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = await hmacSha256Hex(signingKey, stringToSign);
    const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        Host: host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authorizationHeader,
      },
    });

    // S3 DELETE 是幂等的，200 或 204 均视为成功
    if (response.ok || response.status === 204 || response.status === 404) {
      return { success: true };
    }

    const errText = await response.text();
    console.warn(`[R2 Delete Warning] Key: ${cleanKey}, status: ${response.status}`, errText);
    return { success: false, error: `HTTP ${response.status}: ${errText}` };
  } catch (err: any) {
    console.error(`[R2 Delete Exception] Key: ${key}`, err);
    return { success: false, error: err.message || 'Unknown R2 delete error' };
  }
}

/**
 * 列出 Cloudflare R2 指定前缀下的所有对象 Key (ListObjectsV2)
 */
export async function listObjectsFromR2(prefix: string): Promise<string[]> {
  try {
    const { accountId, accessKeyId, secretAccessKey, bucketName } = getR2EnvConfig();
    if (!accountId || !accessKeyId || !secretAccessKey) return [];

    const cleanPrefix = String(prefix || '').replace(/^\/+/, '');
    if (!cleanPrefix) return [];

    const host = `${accountId}.r2.cloudflarestorage.com`;
    const region = 'auto';
    const service = 's3';

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    // Query 字符串必须按字典序排序：list-type=2 在 prefix= 前面
    const encodedPrefix = encodeURIComponent(cleanPrefix);
    const canonicalQueryString = `list-type=2&prefix=${encodedPrefix}`;
    const endpoint = `https://${host}/${bucketName}?${canonicalQueryString}`;

    const canonicalUri = `/${bucketName}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signature = await hmacSha256Hex(signingKey, stringToSign);
    const authorizationHeader = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Host: host,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authorizationHeader,
      },
    });

    if (!response.ok) {
      console.warn(`[R2 ListObjects Warning] prefix: ${cleanPrefix}, status: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    const keys: string[] = [];
    const keyRegex = /<Key>([^<]+)<\/Key>/g;
    let match: RegExpExecArray | null;
    while ((match = keyRegex.exec(xml)) !== null) {
      if (match[1]) {
        keys.push(match[1]);
      }
    }

    return keys;
  } catch (err: any) {
    console.error(`[R2 ListObjects Exception] prefix: ${prefix}`, err);
    return [];
  }
}

/**
 * 彻底物理删除 Cloudflare R2 上对应视频任务的整个文件夹 (包含图片、JSON、视频、音频等所有衍生文件)
 */
export async function deleteFolderFromR2(
  folderPrefix: string
): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  try {
    const raw = String(folderPrefix || '').trim();
    // 强制安全前缀校验：严禁空前缀、根目录、或过短的前缀（必须至少包含一级有效子目录，如 ApCalculusFRQ/xxxx）
    const cleanPrefix = raw.replace(/^\/+|\/+$/g, '');
    if (!cleanPrefix || cleanPrefix.length < 5 || cleanPrefix.split('/').length < 2) {
      console.warn(`[R2 Delete Folder Rejected] 安全拦截：禁止删除过短或根级前缀: "${folderPrefix}"`);
      return { success: false, deletedCount: 0, error: 'Unsafe folder prefix' };
    }

    // 目录前缀强制以 / 结尾，确保仅匹配当前文件夹内部文件，绝不误伤同名开头的其他目录
    const dirPrefix = `${cleanPrefix}/`;

    // 1. 动态从 R2 列出当前文件夹内部的所有真实存在的文件
    const foundKeys = await listObjectsFromR2(dirPrefix);

    // 2. 结合业务已知高频文件集合进行双重兜底合并，确保即使未完全列出也能精准抹除
    const wellKnownFiles = [
      'summary.json',
      'original.json',
      'task.json',
      'desc_zh.md',
      'desc_en.md',
      'description.txt',
      'cover.png',
      'cover_zh.png',
      'cover_en.png',
      'thumbnail.png',
      'diagram.png',
      'audio.mp3',
      'audio_zh.mp3',
      'audio_en.mp3',
      'audio_zh.wav',
      'audio_en.wav',
      'merged_audio.mp3',
      'output.mp4',
      'output_zh.mp4',
      'output_en.mp4',
      'video.mp4',
      'video_zh.mp4',
      'video_en.mp4',
      'final.mp4',
      'render.mp4',
    ];
    const knownKeys = wellKnownFiles.map((f) => `${cleanPrefix}/${f}`);

    const allKeysToDelete = Array.from(new Set([...foundKeys, ...knownKeys]));
    if (allKeysToDelete.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    // 3. 高并发安全物理删除
    const results = await Promise.allSettled(allKeysToDelete.map((key) => deleteFromR2(key)));
    const deletedCount = results.filter((r) => r.status === 'fulfilled' && (r.value as any)?.success).length;

    console.log(`[R2 Folder Deleted Successfully] Prefix: "${cleanPrefix}", Cleared: ${deletedCount} files.`);
    return { success: true, deletedCount };
  } catch (err: any) {
    console.error(`[R2 Delete Folder Exception] Prefix: "${folderPrefix}"`, err);
    return { success: false, deletedCount: 0, error: err.message || 'Unknown folder delete error' };
  }
}
