#!/usr/bin/env node

/**
 * 跨平台 Cloudflare R2 安装包产物自动化上传脚本
 *
 * 功能说明：
 * 1. 自动从 package.json / 环境变量识别当前客户端版本号
 * 2. 自动从 electron-builder.json 获取打包输出目录 (默认 dist-release)
 * 3. 智能重写 latest*.yml 中的下载路径指向版本子目录 (例如 0.1.0/ShortVideo.exe)
 * 4. 自动上传产物到 R2 存储桶 website/${VERSION}/ 归档目录，并将 latest 元数据同步至 website/ 根目录供在线自动更新
 * 5. 优先采用 aws cli 进行高效并发分片上传，自动降级为原生 S3 V4 签名上传
 * 6. 严禁明文硬编码 KEY，安全合规
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { t } = require('./i18n');

// 1. 环境变量加载（遵守安全规则，动态读取）
function parseEnvFile(filePath, env) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!env[key]) env[key] = val;
    }
  }
}

function loadEnv() {
  const env = { ...process.env };
  parseEnvFile(path.resolve(process.cwd(), '.env'), env);
  parseEnvFile(path.resolve(process.cwd(), '.env.desktop'), env);
  return env;
}

const env = loadEnv();
const accountId = env.R2_ACCOUNT_ID;
const accessKeyId = env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
const secretAccessKey = env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
const bucketName = env.R2_BUCKET_NAME || 'shortvideo';

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.log(t('R2_UPLOAD_SKIP'));
  process.exit(0);
}

// 2. 版本号与输出目录检测
function getAppVersion() {
  if (process.env.APP_VERSION) {
    return process.env.APP_VERSION.replace(/^v/i, '').trim();
  }
  if (process.env.GITHUB_REF_NAME) {
    const rawTag = process.env.GITHUB_REF_NAME;
    if (rawTag.startsWith('v') || /^\d+\.\d+\.\d+/.test(rawTag)) {
      return rawTag.replace(/^v/i, '').replace(/-all$/i, '').trim();
    }
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    return (pkg.version || '0.1.0').replace(/^v/i, '').trim();
  } catch {
    return '0.1.0';
  }
}

function getOutputDir() {
  try {
    const builderConfigPath = path.resolve(process.cwd(), 'electron-builder.json');
    if (fs.existsSync(builderConfigPath)) {
      const config = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'));
      if (config.directories && config.directories.output) {
        return config.directories.output;
      }
    }
  } catch {}
  return 'dist-release';
}

const version = getAppVersion();
const outputDirName = getOutputDir();
const outputDir = path.resolve(process.cwd(), outputDirName);

if (!fs.existsSync(outputDir)) {
  console.log(`[R2-Upload] Output directory not found: ${outputDirName}, skipping.`);
  process.exit(0);
}

console.log(t('R2_UPLOAD_START', { version }));

// 3. 检查系统是否存在 AWS CLI
function hasAwsCli() {
  try {
    execSync('aws --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const isAwsCliAvailable = hasAwsCli();

// 4. 原生 S3 V4 上传实现（当没有 aws cli 时的兜底）
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmacSha256('AWS4' + key, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, 'aws4_request');
}

async function uploadFileNative(filePath, s3Key, cacheControl) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const pathname = `/${bucketName}/${s3Key.replace(/^\/+/, '')}`;
  const endpoint = `https://${host}${pathname}`;

  const fileBuffer = fs.readFileSync(filePath);
  const payloadHash = sha256Hex(fileBuffer);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  const reqHeaders = {
    host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    'content-length': String(fileBuffer.length),
  };

  if (cacheControl) {
    reqHeaders['cache-control'] = cacheControl;
  }

  const headerKeys = Object.keys(reqHeaders).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k.toLowerCase()}:${reqHeaders[k]}\n`).join('');
  const signedHeaders = headerKeys.map((k) => k.toLowerCase()).join(';');

  const canonicalRequest = [
    'PUT',
    pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const algorithm = 'AWS4-HMAC-SHA256';
  const region = 'auto';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  reqHeaders['Authorization'] = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: reqHeaders,
    body: fileBuffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed ${res.status}: ${text.slice(0, 200)}`);
  }
}

function uploadFileWithAwsCli(filePath, s3Key, cacheControl) {
  const targetUri = `s3://${bucketName}/${s3Key.replace(/^\/+/, '')}`;
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  let cmd = `aws s3 cp "${filePath}" "${targetUri}" --endpoint-url "${endpoint}"`;
  if (cacheControl) {
    cmd += ` --cache-control "${cacheControl}"`;
  }

  const execEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_DEFAULT_REGION: 'auto',
    MSYS_NO_PATHCONV: '1',
  };

  execSync(cmd, { env: execEnv, stdio: 'inherit' });
}

async function uploadFile(filePath, s3Key, cacheControl) {
  if (isAwsCliAvailable) {
    uploadFileWithAwsCli(filePath, s3Key, cacheControl);
  } else {
    await uploadFileNative(filePath, s3Key, cacheControl);
  }
}

// 5. 主执行逻辑
async function main() {
  const files = fs.readdirSync(outputDir);
  const allowedExts = /\.(exe|dmg|AppImage|deb|rpm|zip|msi|blockmap|7z|tar\.gz|sha256)$/i;
  let uploadCount = 0;

  for (const filename of files) {
    if (filename === 'builder-effective-config.yaml') continue;
    const fullPath = path.join(outputDir, filename);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) continue;

    const isLatestYml = /^latest.*\.ya?ml$/i.test(filename);

    if (isLatestYml) {
      // 重写 latest.yml 内容中的下载相对路径
      let content = fs.readFileSync(fullPath, 'utf8');
      content = content.replace(/(\burl:\s*)([^\r\n\/]+)/g, `$1${version}/$2`);
      content = content.replace(/(\bpath:\s*)([^\r\n\/]+)/g, `$1${version}/$2`);
      fs.writeFileSync(fullPath, content);

      // 上传到版本目录
      console.log(`[R2-Upload] ⬆️ ${filename} -> website/${version}/${filename}`);
      await uploadFile(fullPath, `website/${version}/${filename}`, 'no-cache, no-store, must-revalidate');
      uploadCount++;

      // 上传到根目录 (供自动更新检查)
      console.log(`[R2-Upload] ⬆️ ${filename} -> website/${filename} (auto-updater root)`);
      await uploadFile(fullPath, `website/${filename}`, 'no-cache, no-store, must-revalidate');
      uploadCount++;
    } else if (allowedExts.test(filename)) {
      console.log(`[R2-Upload] ⬆️ ${filename} -> website/${version}/${filename}`);
      await uploadFile(fullPath, `website/${version}/${filename}`, null);
      uploadCount++;
    }
  }

  console.log(t('R2_UPLOAD_SUCCESS', { count: uploadCount }));
}

main().catch((err) => {
  console.error(`[R2-Upload] ❌ Error: ${err.message}`);
  process.exit(1);
});
