#!/usr/bin/env node

/**
 * Cloudflare R2 website 发布目录智能管理与清理工具
 *
 * 功能说明：
 * 1. 扫描 R2 存储桶 shortvideo/website/ 下的所有版本目录
 * 2. 自动统计每个目录的文件总数、占用空间大小及最后更新时间
 * 3. 自动识别并严格锁定“最近的一个版本号目录”，绝对禁止删除
 * 4. 提供友好交互式菜单供用户勾选/选择需要清理的历史旧版本目录
 * 5. 采用 AWS S3 批量删除协议安全高效释放 R2 存储空间
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { t } = require('./i18n');

// ==========================================
// 1. 终端彩色输出样式配置
// ==========================================
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr;
  }
}

// ==========================================
// 2. 环境变量加载（遵守安全规则，动态读取，绝无硬编码）
// ==========================================
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
  // 优先加载 .env
  parseEnvFile(path.resolve(process.cwd(), '.env'), env);
  // 次优加载 .env.desktop
  parseEnvFile(path.resolve(process.cwd(), '.env.desktop'), env);

  // 兜底尝试 wrangler.toml
  const wranglerPath = path.resolve(process.cwd(), 'wrangler.toml');
  if (fs.existsSync(wranglerPath)) {
    const content = fs.readFileSync(wranglerPath, 'utf8');
    const regex = /^\s*([A-Za-z0-9_]+)\s*=\s*["']([^"']+)["']/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const [, key, val] = match;
      if (!env[key]) env[key] = val;
    }
  }

  return env;
}

const env = loadEnv();
const accountId = env.R2_ACCOUNT_ID;
const accessKeyId = env.R2_ACCESS_KEY_ID;
const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
const bucketName = env.R2_BUCKET_NAME || 'shortvideo';

if (!accountId || !accessKeyId || !secretAccessKey) {
  log(t('R2_MISSING_CREDS'), 'red');
  log(t('R2_MISSING_CREDS_TIP'), 'yellow');
  log('  - R2_ACCOUNT_ID', 'dim');
  log('  - R2_ACCESS_KEY_ID', 'dim');
  log('  - R2_SECRET_ACCESS_KEY', 'dim');
  log('  - R2_BUCKET_NAME (默认 shortvideo)', 'dim');
  process.exit(1);
}

// ==========================================
// 3. AWS Signature Version 4 纯原生实现
// ==========================================
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

async function s3Request({ method, pathname = '/', query = {}, body = '', headers = {} }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const queryString = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&');

  const fullPath = pathname + (queryString ? `?${queryString}` : '');
  const endpoint = `https://${host}${fullPath}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);
  const payloadHash = sha256Hex(body);

  const reqHeaders = {
    host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...headers,
  };

  const headerKeys = Object.keys(reqHeaders).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k.toLowerCase()}:${reqHeaders[k]}\n`).join('');
  const signedHeaders = headerKeys.map((k) => k.toLowerCase()).join(';');

  const canonicalRequest = [
    method,
    pathname,
    queryString,
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
    method,
    headers: reqHeaders,
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });

  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

// ==========================================
// 4. 版本号比较与排序算法 (Semver + 时间兜底)
// ==========================================
function parseVersion(verStr) {
  const clean = verStr.replace(/^v/i, '').trim();
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (match) {
    return {
      valid: true,
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
      prerelease: match[4] || null,
      raw: clean,
    };
  }
  return { valid: false, raw: clean };
}

function compareVersions(a, b) {
  const vA = parseVersion(a.name);
  const vB = parseVersion(b.name);

  if (vA.valid && vB.valid) {
    if (vA.major !== vB.major) return vA.major - vB.major;
    if (vA.minor !== vB.minor) return vA.minor - vB.minor;
    if (vA.patch !== vB.patch) return vA.patch - vB.patch;
    if (!vA.prerelease && vB.prerelease) return 1;
    if (vA.prerelease && !vB.prerelease) return -1;
    return String(vA.prerelease || '').localeCompare(String(vB.prerelease || ''));
  }

  if (vA.valid && !vB.valid) return 1;
  if (!vA.valid && vB.valid) return -1;

  // 兜底：按最新文件修改时间排序
  const timeA = new Date(a.lastModified || 0).getTime();
  const timeB = new Date(b.lastModified || 0).getTime();
  if (timeA !== timeB) return timeA - timeB;

  return a.name.localeCompare(b.name);
}

// ==========================================
// 5. 扫描与统计目录
// ==========================================
async function listWebsiteDirectories() {
  const prefix = 'website/';
  const res = await s3Request({
    method: 'GET',
    pathname: `/${bucketName}`,
    query: {
      'list-type': '2',
      prefix,
      delimiter: '/',
    },
  });

  if (!res.ok) {
    throw new Error(`获取目录列表失败 (HTTP ${res.status}): ${res.text.slice(0, 300)}`);
  }

  const prefixMatches = [...res.text.matchAll(/<CommonPrefixes><Prefix>([^<]+)<\/Prefix><\/CommonPrefixes>/g)];
  const rawPrefixes = prefixMatches.map((m) => m[1]);

  const directories = [];

  for (const dirPrefix of rawPrefixes) {
    const subName = dirPrefix.slice(prefix.length).replace(/\/$/, '');
    if (!subName) continue;

    const stats = await getDirectoryStats(dirPrefix);
    directories.push({
      prefix: dirPrefix,
      name: subName,
      fileCount: stats.fileCount,
      totalBytes: stats.totalBytes,
      lastModified: stats.lastModified,
    });
  }

  // 降序排序，最新版本排在第一个
  directories.sort((a, b) => compareVersions(b, a));

  return directories;
}

async function getDirectoryStats(prefix) {
  let continuationToken = null;
  let fileCount = 0;
  let totalBytes = 0;
  let lastModified = null;

  do {
    const query = {
      'list-type': '2',
      prefix,
    };
    if (continuationToken) {
      query['continuation-token'] = continuationToken;
    }

    const res = await s3Request({
      method: 'GET',
      pathname: `/${bucketName}`,
      query,
    });

    if (!res.ok) {
      throw new Error(`统计目录信息失败 ${prefix}: ${res.text.slice(0, 200)}`);
    }

    const keyMatches = [...res.text.matchAll(/<Key>([^<]+)<\/Key>/g)];
    const sizeMatches = [...res.text.matchAll(/<Size>(\d+)<\/Size>/g)];
    const dateMatches = [...res.text.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)];

    for (let i = 0; i < keyMatches.length; i++) {
      const size = parseInt(sizeMatches[i] ? sizeMatches[i][1] : '0', 10);
      const date = dateMatches[i] ? dateMatches[i][1] : null;

      fileCount++;
      totalBytes += size;

      if (date) {
        if (!lastModified || new Date(date).getTime() > new Date(lastModified).getTime()) {
          lastModified = date;
        }
      }
    }

    const isTruncatedMatch = res.text.match(/<IsTruncated>(true|false)<\/IsTruncated>/);
    const isTruncated = isTruncatedMatch ? isTruncatedMatch[1] === 'true' : false;

    if (isTruncated) {
      const nextTokenMatch = res.text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      continuationToken = nextTokenMatch ? nextTokenMatch[1] : null;
    } else {
      continuationToken = null;
    }
  } while (continuationToken);

  return { fileCount, totalBytes, lastModified };
}

// ==========================================
// 6. 安全批量删除目录（核心防呆校验）
// ==========================================
async function deleteObjects(keys) {
  if (!keys || keys.length === 0) return 0;

  const xmlBody = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Delete>',
    '  <Quiet>true</Quiet>',
    ...keys.map((k) => `  <Object><Key>${escapeXml(k)}</Key></Object>`),
    '</Delete>',
  ].join('\n');

  const res = await s3Request({
    method: 'POST',
    pathname: `/${bucketName}`,
    query: { delete: '' },
    body: xmlBody,
    headers: { 'Content-Type': 'application/xml' },
  });

  if (!res.ok) {
    throw new Error(`批量删除对象失败: ${res.text.slice(0, 300)}`);
  }

  return keys.length;
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
    return c;
  });
}

async function deleteDirectory(dirItem, protectedVersion) {
  // 🛡️ 最高优先级安全断言：绝对禁止删除最新版本目录
  if (dirItem.name === protectedVersion.name || dirItem.prefix === protectedVersion.prefix) {
    throw new Error(`【安全拦截】绝对禁止删除最近的最新版本目录: ${dirItem.name}！操作已强制中止！`);
  }

  let continuationToken = null;
  let deletedCount = 0;

  do {
    const query = {
      'list-type': '2',
      prefix: dirItem.prefix,
    };
    if (continuationToken) {
      query['continuation-token'] = continuationToken;
    }

    const res = await s3Request({
      method: 'GET',
      pathname: `/${bucketName}`,
      query,
    });

    if (!res.ok) {
      throw new Error(`获取待删除列表失败 ${dirItem.prefix}: ${res.text.slice(0, 200)}`);
    }

    const keyMatches = [...res.text.matchAll(/<Key>([^<]+)<\/Key>/g)];
    const keys = keyMatches.map((m) => m[1]);

    if (keys.length > 0) {
      await deleteObjects(keys);
      deletedCount += keys.length;
    }

    const isTruncatedMatch = res.text.match(/<IsTruncated>(true|false)<\/IsTruncated>/);
    const isTruncated = isTruncatedMatch ? isTruncatedMatch[1] === 'true' : false;

    if (isTruncated) {
      const nextTokenMatch = res.text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      continuationToken = nextTokenMatch ? nextTokenMatch[1] : null;
    } else {
      continuationToken = null;
    }
  } while (continuationToken);

  return deletedCount;
}

// ==========================================
// 7. 用户交互式命令行入口
// ==========================================
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  console.log('');
  log('====================================================', 'cyan');
  log(t('R2_BANNER_TITLE'), 'bold');
  log('====================================================', 'cyan');
  log(`[R2 存储桶] : ${bucketName}`, 'dim');
  log(`[扫描前缀] : website/`, 'dim');
  if (isDryRun) {
    log('⚠️  [演练模式] 当前启用了 --dry-run，不会真正执行任何删除操作', 'yellow');
  }
  log(t('R2_SCANNING'), 'cyan');

  let directories = [];
  try {
    directories = await listWebsiteDirectories();
  } catch (err) {
    log(`❌ 扫描失败: ${err.message}`, 'red');
    process.exit(1);
  }

  if (directories.length === 0) {
    log(t('R2_NO_DIRS'), 'yellow');
    return;
  }

  // 排序后的第一个为“最近的一个版本号目录”
  const latestDir = directories[0];
  const selectableDirs = directories.slice(1);

  console.log('');
  log(`共检索到 ${directories.length} 个版本目录：`, 'bold');
  console.log(
    `${colors.dim}序号   目录名称        文件数      占用空间      最后更新时间 (北京时间)   状态保护${colors.reset}`
  );
  console.log('-'.repeat(82));

  // 1. 先输出受保护的最新版本
  const latestNameCol = latestDir.name.padEnd(14, ' ');
  const latestFilesCol = `${latestDir.fileCount} 个`.padEnd(10, ' ');
  const latestSizeCol = formatBytes(latestDir.totalBytes).padEnd(12, ' ');
  const latestDateCol = formatDate(latestDir.lastModified).padEnd(24, ' ');

  console.log(
    `[--]   ${colors.bold}${latestNameCol}${colors.reset}  ${latestFilesCol}  ${latestSizeCol}  ${latestDateCol}  ${colors.green}${t('R2_LOCKED_LATEST')}${colors.reset}`
  );

  // 2. 依次输出历史版本
  selectableDirs.forEach((dir, idx) => {
    const numCol = `[${String(idx + 1).padStart(2, ' ')}]`;
    const nameCol = dir.name.padEnd(14, ' ');
    const filesCol = `${dir.fileCount} 个`.padEnd(10, ' ');
    const sizeCol = formatBytes(dir.totalBytes).padEnd(12, ' ');
    const dateCol = formatDate(dir.lastModified).padEnd(24, ' ');

    console.log(
      `${colors.cyan}${numCol}${colors.reset}   ${nameCol}  ${filesCol}  ${sizeCol}  ${dateCol}  ${colors.yellow}${t('R2_DELETABLE')}${colors.reset}`
    );
  });

  console.log('-'.repeat(82));
  console.log('');

  // 如果没有可删除的历史版本
  if (selectableDirs.length === 0) {
    log(t('R2_ONLY_ONE_DIR', { name: latestDir.name }), 'green');
    return;
  }

  // 计算可释放的历史总空间
  const totalSelectableBytes = selectableDirs.reduce((acc, d) => acc + d.totalBytes, 0);
  const totalSelectableFiles = selectableDirs.reduce((acc, d) => acc + d.fileCount, 0);
  log(
    `💡 提示: 共有 ${selectableDirs.length} 个历史版本可删除，总计 ${totalSelectableFiles} 个文件，可释放空间约 ${formatBytes(totalSelectableBytes)}。`,
    'dim'
  );
  log(`🛡️  最新版本 [${latestDir.name}] 已被程序锁定，任何操作均无法删除该版本。`, 'green');
  console.log('');

  // 3. 用户交互选择
  const input = await askQuestion(
    `${colors.bold}请选择要删除的目录序号 ${colors.cyan}(例如输入 1 或 1,2 或 all 全部删除，输入 0 或 q 取消): ${colors.reset}`
  );

  if (!input || input.toLowerCase() === 'q' || input === '0') {
    log('已取消操作，未对 R2 存储桶进行任何更改。', 'dim');
    return;
  }

  let selectedDirs = [];

  if (input.toLowerCase() === 'all') {
    selectedDirs = [...selectableDirs];
  } else {
    const rawTokens = input.split(/[,，\s]+/).filter(Boolean);
    const chosenIndexes = new Set();

    for (const token of rawTokens) {
      if (token === latestDir.name || token === '--' || token === 'latest') {
        log(`⚠️  已自动忽略 [${latestDir.name}]：最新版本受程序保护，禁止删除！`, 'yellow');
        continue;
      }

      const num = parseInt(token, 10);
      if (isNaN(num) || num < 1 || num > selectableDirs.length) {
        log(`⚠️  无效序号: "${token}"，已自动忽略。`, 'yellow');
        continue;
      }
      chosenIndexes.add(num - 1);
    }

    selectedDirs = Array.from(chosenIndexes).map((idx) => selectableDirs[idx]);
  }

  if (selectedDirs.length === 0) {
    log('未选择任何有效目录，操作已退出。', 'yellow');
    return;
  }

  // 4. 展示待删除清单与二次确认
  const planBytes = selectedDirs.reduce((acc, d) => acc + d.totalBytes, 0);
  const planFiles = selectedDirs.reduce((acc, d) => acc + d.fileCount, 0);

  console.log('');
  log('================== 待删除清理清单 ==================', 'red');
  selectedDirs.forEach((dir) => {
    log(`  - website/${dir.name}/ (${dir.fileCount} 个文件, ${formatBytes(dir.totalBytes)})`, 'red');
  });
  log(`预计清理: ${selectedDirs.length} 个版本目录，共 ${planFiles} 个文件，预计释放空间: ${formatBytes(planBytes)}`, 'bold');
  log('====================================================', 'red');
  console.log('');

  if (isDryRun) {
    log('🎯 [演练模式] 模拟流程已顺利完成！真实模式下将删除上述目录。', 'green');
    return;
  }

  const confirm = await askQuestion(
    `${colors.bold}${colors.bgRed} 警告 ${colors.reset} ${colors.bold}确认永久删除上述 ${selectedDirs.length} 个目录吗？操作不可逆！(输入 yes 确认): ${colors.reset}`
  );

  if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
    log('已取消删除操作，存储桶无变动。', 'dim');
    return;
  }

  // 5. 执行删除
  console.log('');
  log('🚀 开始执行 R2 目录清理...', 'cyan');

  let successCount = 0;
  let totalDeletedObjects = 0;

  for (const dir of selectedDirs) {
    try {
      process.stdout.write(`  正在删除 ${dir.prefix} (${dir.fileCount} 个文件)... `);
      const count = await deleteDirectory(dir, latestDir);
      totalDeletedObjects += count;
      successCount++;
      console.log(`${colors.green}✅ 完成 (已清除 ${count} 个对象)${colors.reset}`);
    } catch (err) {
      console.log(`${colors.red}❌ 失败: ${err.message}${colors.reset}`);
    }
  }

  console.log('');
  log('====================================================', 'green');
  log(
    t('R2_CLEAN_ALL_DONE', {
      success: successCount,
      total: selectedDirs.length,
      files: totalDeletedObjects,
      size: formatBytes(planBytes),
    }),
    'green'
  );
  log(t('R2_PROTECT_RETAINED', { name: latestDir.name }), 'bold');
  log('====================================================', 'green');
}

main().catch((err) => {
  log(`\n❌ 程序执行异常: ${err.message}`, 'red');
  process.exit(1);
});
