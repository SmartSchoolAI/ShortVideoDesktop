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
  return (
    env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ||
    env.DOWNLOAD_BASE_URL ||
    process.env.NEXT_PUBLIC_DOWNLOAD_BASE_URL ||
    process.env.DOWNLOAD_BASE_URL ||
    ''
  );
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

    const cleanKey = key.startsWith('/') ? key.substring(1) : key;
    const buffer: Uint8Array =
      typeof content === 'string'
        ? new TextEncoder().encode(content)
        : content instanceof Uint8Array
        ? content
        : new Uint8Array(content);

    const host = `${accountId}.r2.cloudflarestorage.com`;
    const endpoint = `https://${host}/${bucketName}/${cleanKey}`;
    const region = 'auto';
    const service = 's3';

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    const payloadHash = await sha256Hex(buffer);

    const canonicalUri = `/${bucketName}/${encodeURI(cleanKey)}`;
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

    const cdnBase = getCdnBase();

    if (!response.ok) {
      const errText = await response.text();
      console.error('[R2 Upload Error]', response.status, errText);
      return {
        success: false,
        url: `${cdnBase}/${cleanKey}`,
        error: `HTTP ${response.status}: ${errText.substring(0, 300)}`,
      };
    }

    return {
      success: true,
      url: `${cdnBase}/${cleanKey}`,
    };
  } catch (err: any) {
    console.error('[R2 Upload Exception]', err);
    const cdnBase = getCdnBase();
    return {
      success: false,
      url: `${cdnBase}/${key}`,
      error: err.message || 'Unknown R2 upload error',
    };
  }
}
