/**
 * 自动化 GitHub Release 发布与更新脚本 (API 优先全自动模式)
 * 用法:
 *   pnpm run release             # 自动获取最新 Git Tag 并通过 GitHub API 自动创建/更新 Release
 *   pnpm run release v0.2.7      # 指定特定 Tag 进行 Release 发布
 *   pnpm run release --draft     # 创建为 Draft 草稿状态
 *   pnpm run release --dry-run   # 预览 Release Notes 说明，不提交发布
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { t } = require('./i18n');

// 自动加载多级 .env 文件
function loadEnvFiles() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env.desktop'),
  ];
  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const idx = trimmed.indexOf('=');
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim().replace(/(^["'])|(["']$)/g, '');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch (_) { }
    }
  }
}
loadEnvFiles();

const isTTY = Boolean(process.stdout && process.stdout.isTTY);
const c = {
  reset: isTTY ? '\x1b[0m' : '',
  bold: isTTY ? '\x1b[1m' : '',
  green: isTTY ? '\x1b[32m' : '',
  yellow: isTTY ? '\x1b[33m' : '',
  blue: isTTY ? '\x1b[34m' : '',
  cyan: isTTY ? '\x1b[36m' : '',
  red: isTTY ? '\x1b[31m' : '',
  gray: isTTY ? '\x1b[90m' : '',
};

function run(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe', ...options }).trim();
  } catch (error) {
    if (options.ignoreError) {
      return '';
    }
    throw error;
  }
}

function getRemoteName() {
  const remotes = run('git remote', { ignoreError: true })
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);

  if (remotes.includes('origin')) return 'origin';
  return remotes[0] || 'origin';
}

function getGitHubRepoInfo(remote) {
  try {
    const url = run(`git remote get-url ${remote}`, { ignoreError: true }) || '';
    let match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
    }
  } catch { }
  return { owner: 'SmartSchoolAI', repo: 'ShortVideoDesktop' };
}

function getGitCredentialToken() {
  try {
    const output = execSync('echo url=https://github.com/SmartSchoolAI/ShortVideoDesktop.git | git credential fill', {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith('password=')) {
        return line.replace('password=', '').trim();
      }
    }
  } catch (_) { }
  return '';
}

function findGitHubToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;
  if (envToken) return envToken;

  const gitCredToken = getGitCredentialToken();
  if (gitCredToken) return gitCredToken;

  const appdata = process.env.APPDATA || '';
  const localappdata = process.env.LOCALAPPDATA || '';
  const home = process.env.USERPROFILE || process.env.HOME || '';

  const candidatePaths = [
    path.join(appdata, 'GitHub CLI', 'hosts.yml'),
    path.join(localappdata, 'GitHub CLI', 'hosts.yml'),
    path.join(home, '.config', 'gh', 'hosts.yml'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf-8');
        const m = text.match(/oauth_token:\s*([^\s]+)/);
        if (m && m[1]) {
          return m[1].trim();
        }
      } catch (_) { }
    }
  }

  return '';
}

function getLatestTags() {
  const raw = run('git tag -l "v*" --sort=-v:refname', { ignoreError: true }) || '';
  const tags = raw.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  return tags;
}

function getCommitsBetween(prevTag, targetTag) {
  const range = prevTag ? `${prevTag}..${targetTag}` : targetTag;
  const raw = run(`git log ${range} --pretty=format:"* %s (%h)"`, { ignoreError: true }) || '';
  return raw.split(/\r?\n/).filter(Boolean);
}

function sendGitHubAPI(method, apiPath, token, payload = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = payload ? JSON.stringify(payload) : '';
    const headers = {
      'User-Agent': 'ShortVideo-Release-Agent',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    };
    if (bodyStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method: method,
      headers: headers,
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => (responseData += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ statusCode: res.statusCode, data: parsed });
        } catch (_) {
          resolve({ statusCode: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function uploadReleaseAsset(owner, repo, releaseId, filePath, token) {
  return new Promise(async (resolve) => {
    const filename = path.basename(filePath);
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    try {
      // 1. 检查并删除已存在的同名 Asset
      const assetsRes = await sendGitHubAPI('GET', `/repos/${owner}/${repo}/releases/${releaseId}/assets`, token);
      if (assetsRes.statusCode === 200 && Array.isArray(assetsRes.data)) {
        const existing = assetsRes.data.find((a) => a.name === filename);
        if (existing) {
          console.log(`  └─ 🗑️ 发现旧附件文件 ${filename} (ID: ${existing.id})，正在覆盖清理...`);
          await sendGitHubAPI('DELETE', `/repos/${owner}/${repo}/releases/assets/${existing.id}`, token);
        }
      }

      console.log(`  └─ ⬆️ 正在上传安装包资源 [${filename}] (${sizeMB} MB)...`);

      const headers = {
        'User-Agent': 'ShortVideo-Release-Agent',
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size,
      };

      const options = {
        hostname: 'uploads.github.com',
        path: `/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(filename)}`,
        method: 'POST',
        headers: headers,
      };

      const req = https.request(options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          if (res.statusCode === 201 || res.statusCode === 200) {
            console.log(`  └─ ✅ [${filename}] 上传成功!`);
            resolve(true);
          } else {
            console.log(`  └─ ⚠️ [${filename}] 上传失败 (Status: ${res.statusCode}): ${responseData}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.log(`  └─ ❌ [${filename}] 上传出错: ${err.message}`);
        resolve(false);
      });

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(req);
    } catch (e) {
      console.log(`  └─ ❌ [${filename}] 上传过程异常: ${e.message}`);
      resolve(false);
    }
  });
}


async function getCloudBuildInfo(owner, repo, targetTag, token) {
  console.log(`${c.cyan}${t('RELEASE_SEARCHING_CLOUD_ARTIFACTS', { tag: targetTag })}${c.reset}`);

  // 1. 获取 Tag 对应的 commit SHA
  let commitSha = run(`git rev-parse refs/tags/${targetTag}^{commit}`, { ignoreError: true })
    || run(`git rev-parse ${targetTag}^{commit}`, { ignoreError: true });

  if (!commitSha) {
    try {
      const tagRefRes = await sendGitHubAPI('GET', `/repos/${owner}/${repo}/git/ref/tags/${targetTag}`, token);
      if (tagRefRes.statusCode === 200 && tagRefRes.data && tagRefRes.data.object) {
        commitSha = tagRefRes.data.object.sha;
      }
    } catch (_) { }
  }

  // 2. 查询相关的 GitHub Actions Workflow Runs
  let runsRes = await sendGitHubAPI('GET', `/repos/${owner}/${repo}/actions/runs?per_page=30`, token);
  if (runsRes.statusCode !== 200 || !runsRes.data || !Array.isArray(runsRes.data.workflow_runs)) {
    return { targetRun: null, artifacts: [] };
  }

  const runs = runsRes.data.workflow_runs;
  // 匹配 run：优先按 commitSha 匹配，或按 head_branch 匹配
  let targetRun = null;
  if (commitSha) {
    targetRun = runs.find((r) => r.head_sha === commitSha);
  }
  if (!targetRun) {
    targetRun = runs.find((r) => r.head_branch === targetTag);
  }

  if (!targetRun) {
    console.log(`${c.yellow}[Cloud Assets] 未在 GitHub Actions 找到与 Tag ${targetTag} 对应的构建流水线记录。${c.reset}`);
    return { targetRun: null, artifacts: [] };
  }

  console.log(`${c.bold}[Workflow Run]${c.reset}    : ID ${targetRun.id} (Status: ${targetRun.status}, Conclusion: ${targetRun.conclusion || 'pending'})`);
  console.log(`${c.gray}   流水线链接: ${targetRun.html_url}${c.reset}`);

  // 检查是否还在打包中
  if (targetRun.status !== 'completed') {
    console.log(`\n${c.yellow}${t('RELEASE_BUILD_IN_PROGRESS', { status: targetRun.status, url: targetRun.html_url })}${c.reset}`);
    return { inProgress: true, runUrl: targetRun.html_url, targetRun, artifacts: [] };
  }

  // 检查是否构建失败
  if (targetRun.conclusion === 'failure') {
    console.log(`\n${c.red}${t('RELEASE_BUILD_FAILED', { status: targetRun.conclusion, url: targetRun.html_url })}${c.reset}`);
    return { failed: true, runUrl: targetRun.html_url, targetRun, artifacts: [] };
  }

  // 3. 获取该 run 的 artifacts (仅读取元数据，不下载任何文件到本地)
  const artifactsRes = await sendGitHubAPI('GET', `/repos/${owner}/${repo}/actions/runs/${targetRun.id}/artifacts`, token);
  if (artifactsRes.statusCode !== 200 || !artifactsRes.data || !Array.isArray(artifactsRes.data.artifacts) || artifactsRes.data.artifacts.length === 0) {
    console.log(`${c.yellow}[Cloud Assets] 该云端流水线未生成制品包 (Artifacts)。${c.reset}`);
    return { targetRun, artifacts: [] };
  }

  const artifacts = artifactsRes.data.artifacts;
  console.log(`${c.green}${t('RELEASE_CLOUD_ARTIFACTS_FOUND', { count: artifacts.length })}${c.reset}`);

  return { targetRun, artifacts };
}

async function waitForCloudPublishRun(owner, repo, token, triggerTime) {
  let matchedRun = null;
  let elapsed = 0;
  const timeoutMs = 180000; // 最长等待 3 分钟

  while (elapsed < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    elapsed += 4000;
    const seconds = Math.round(elapsed / 1000);

    console.log(c.cyan + t('RELEASE_CLOUD_PUBLISHING_PROGRESS', { seconds }) + c.reset);

    if (!matchedRun) {
      const runsRes = await sendGitHubAPI('GET', `/repos/${owner}/${repo}/actions/workflows/publish-release.yml/runs?event=workflow_dispatch&per_page=5`, token);
      if (runsRes.statusCode === 200 && runsRes.data && Array.isArray(runsRes.data.workflow_runs)) {
        const found = runsRes.data.workflow_runs.find((r) => new Date(r.created_at).getTime() >= triggerTime - 10000);
        if (found) {
          matchedRun = found;
        }
      }
    }

    if (matchedRun) {
      const checkRes = await sendGitHubAPI('GET', `/repos/${owner}/${repo}/actions/runs/${matchedRun.id}`, token);
      if (checkRes.statusCode === 200 && checkRes.data) {
        const current = checkRes.data;
        if (current.status === 'completed') {
          return current.conclusion === 'success';
        }
      }
    }
  }
  return false;
}

function getReleaseOutputDir() {
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

function getReleaseAssets() {
  const configuredDirName = getReleaseOutputDir();
  let releaseDir = path.resolve(process.cwd(), configuredDirName);
  if (!fs.existsSync(releaseDir) && configuredDirName !== 'release') {
    const fallbackDir = path.resolve(process.cwd(), 'release');
    if (fs.existsSync(fallbackDir)) {
      releaseDir = fallbackDir;
    }
  }
  if (!fs.existsSync(releaseDir)) return [];

  const files = fs.readdirSync(releaseDir);
  const assets = [];
  const allowedExts = /\.(exe|dmg|AppImage|deb|rpm|zip|msi|blockmap|7z)$/i;

  for (const file of files) {
    if (file === 'builder-effective-config.yaml') continue;
    const fullPath = path.join(releaseDir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        if (allowedExts.test(file) || file.startsWith('latest')) {
          assets.push(fullPath);
        }
      }
    } catch (_) { }
  }

  return assets;
}

function extractCleanVersion(tagOrVersion) {
  if (!tagOrVersion) return '';
  // 去除可能的前缀 v 或 V
  let v = String(tagOrVersion).trim().replace(/^v/i, '');
  // 提取纯净的核心语义版本号 (如 0.1.10)
  const coreMatch = v.match(/^(\d+\.\d+\.\d+)/);
  if (coreMatch) {
    return coreMatch[1];
  }
  return v;
}

function syncWranglerDownloadVersion(rawVersion, isDryRun = false) {
  const cleanVersion = extractCleanVersion(rawVersion);
  if (!cleanVersion) {
    return;
  }

  const candidatePaths = [
    path.resolve(__dirname, '../../ShortVideo/wrangler.toml'),
    path.resolve(__dirname, '../../../ShortVideo/wrangler.toml'),
    path.resolve(process.cwd(), '../ShortVideo/wrangler.toml'),
    path.resolve(process.cwd(), '../../ShortVideo/wrangler.toml'),
  ];

  let wranglerPath = candidatePaths.find((p) => {
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });

  if (!wranglerPath) {
    console.log(`${c.yellow}${t('RELEASE_SYNC_WRANGLER_NOT_FOUND')}${c.reset}`);
    return;
  }

  try {
    const content = fs.readFileSync(wranglerPath, 'utf8');
    const versionRegex = /(NEXT_PUBLIC_DOWNLOAD_VERSION\s*=\s*)(["'][^"']*["'])/;
    if (versionRegex.test(content)) {
      const currentMatch = content.match(versionRegex);
      const currentVal = currentMatch[2].replace(/["']/g, '');

      if (currentVal === cleanVersion) {
        console.log(`${c.green}${t('RELEASE_SYNC_WRANGLER_ALREADY_LATEST', { file: wranglerPath, version: cleanVersion })}${c.reset}`);
        return;
      }

      if (isDryRun) {
        console.log(`${c.cyan}[Dry-Run] 拟将 ${wranglerPath} 中的 NEXT_PUBLIC_DOWNLOAD_VERSION 从 "${currentVal}" 更新为 "${cleanVersion}"${c.reset}`);
        return;
      }

      const updated = content.replace(versionRegex, `$1"${cleanVersion}"`);
      fs.writeFileSync(wranglerPath, updated, 'utf8');
      console.log(`${c.green}${t('RELEASE_SYNC_WRANGLER_SUCCESS', { file: wranglerPath, version: cleanVersion })}${c.reset}`);
    }
  } catch (err) {
    console.error(`${c.red}[Wrangler Sync Error] ${err.message}${c.reset}`);
  }
}

// 主程序
async function main() {
  console.log(`\n${c.cyan}====================================================${c.reset}`);
  console.log(`${c.bold}${c.green}${t('RELEASE_BANNER_TITLE')}${c.reset}`);
  console.log(`${c.cyan}====================================================${c.reset}`);

  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('-n');
  const isDraft = args.includes('--draft');
  const isPrerelease = args.includes('--prerelease');
  const isDispatch = args.includes('--dispatch') || args.includes('--all-platforms');

  let targetTag = args.find((a) => a.startsWith('v') && !a.startsWith('--'));

  const tags = getLatestTags();
  if (!targetTag) {
    targetTag = tags[0] || run('git describe --tags --abbrev=0', { ignoreError: true });
  }

  if (!targetTag) {
    console.error(`${c.red}${t('RELEASE_NO_TAG')}${c.reset}`);
    process.exit(1);
  }

  // 自动同步更新 D:\Github\ShortVideo\wrangler.toml 中的 NEXT_PUBLIC_DOWNLOAD_VERSION 为纯净版本号 (不带 v)
  syncWranglerDownloadVersion(targetTag, isDryRun);

  const prevTag = tags.find((t) => t !== targetTag) || '';
  const commits = getCommitsBetween(prevTag, targetTag);
  const repoInfo = getGitHubRepoInfo(getRemoteName());

  const releaseTitle = `ShortVideo ${targetTag}`;

  let changelogSection = commits.length > 0
    ? commits.join('\n')
    : '* Initial release updates and stability improvements.';

  const releaseNotes = `## 🎬 ShortVideo - 全球短视频多语言创作与自动化发布平台

**ShortVideo** 是一款面向全球短视频创作者、知识科普、跨境电商与内容团队的自动化视频生成、多语言字幕本地化与矩阵发布桌面/Web平台。

### ✨ 核心功能与亮点 (Key Features)

1. 🌐 **全球 14 种核心高 CPM 语言覆盖**：
   * 包含 **中文(zh)**, **英语(en)**, **日语(ja)**, **韩语(ko)**, **越南语(vi)**, **泰语(th)**, **印尼语(id)**, **西班牙语(es)**, **法语(fr)**, **葡萄牙语(pt)**, **德语(de)**, **意大利语(it)**, **俄语(ru)**, **土耳其语(tr)**。
   * 智能字幕翻译、多语言字幕排版与动态音画同步。

2. 🤖 **自动化社交平台发布 (Playwright / CDP)**：
   * 集成 **微信视频号 (Channels)** 与 **小红书 (RED)** 创作服务平台的自动化视频发布。
   * 采用原生 CDP/Playwright 协议，完全模拟人类拟真打字速率与物理交互，保障账号安全。

3. 📚 **全学科短视频创作支持**：
   * 涵盖 **英语**、**数学**、**物理**、**化学**、**历史**、**地理** 等多学科知识科普与教学短视频的高效渲染与生成。

4. 💻 **Web 在线制作 + 桌面客户端双重体验**：
   * 支持 Web 端在线快速制作与发布，同时提供桌面客户端，无缝进行视频号、小红书等平台的自动化一键发布。

5. 💰 **按需扣费，透明无会员绑架**：
   * 采用充值积分、按需实用实扣机制，无任何强制订阅与会员费，单条视频生成成本仅在 **2 - 4 元** 之间，性价比极高。

6. 📱 **多平台生态覆盖与演进**：
   * 已全面支持 **YouTube (油管)**、**微信视频号**、**小红书** 等主流平台；**抖音**、**B站**、**META (Facebook)**、**Instagram** 等平台正持续接入中。

7. 🎙️ **丰富优质声音模型选择**：
   * 内置多种顶级音色与声音模型，支持按语种、角色与情感灵活切换，打造逼真自然的配音体验。

---

## 📦 ShortVideo ${targetTag} Release

### 🚀 变更日志 (What's Changed)
${changelogSection}

---
### ⬇️ 快速链接 (Downloads & Links)
* 🌐 **Web 应用**: https://app.shortvideo.ca
* ⚡ **Release 标签**: https://github.com/${repoInfo.owner}/${repoInfo.repo}/releases/tag/${targetTag}
`;

  const token = findGitHubToken();
  let cloudInfo = { targetRun: null, artifacts: [] };

  if (token) {
    cloudInfo = await getCloudBuildInfo(repoInfo.owner, repoInfo.repo, targetTag, token);
    if (cloudInfo.inProgress) {
      process.exit(1);
    }
    if (cloudInfo.failed) {
      process.exit(1);
    }
  }

  console.log(`${c.bold}[Release Target]${c.reset}  : ${c.yellow}${targetTag}${c.reset}`);
  console.log(`${c.bold}[Previous Tag]${c.reset}    : ${c.gray}${prevTag || 'None'}${c.reset}`);
  console.log(`${c.bold}[Commit Count]${c.reset}    : ${c.cyan}${commits.length}${c.reset}`);
  console.log(`${c.bold}[Repository]${c.reset}      : ${c.blue}${repoInfo.owner}/${repoInfo.repo}${c.reset}`);
  console.log(`${c.bold}[Cloud Artifacts]${c.reset}: ${c.green}${cloudInfo.artifacts.length} 个云端打包产物${c.reset}\n`);

  if (cloudInfo.artifacts.length > 0) {
    for (const a of cloudInfo.artifacts) {
      const sizeMB = (a.size_in_bytes / (1024 * 1024)).toFixed(2);
      console.log(`  📦 [Cloud Package] ${a.name} (${sizeMB} MB)`);
    }
    console.log('');
  }

  console.log(`${c.gray}---------------- Release Notes Preview ----------------${c.reset}`);
  console.log(releaseNotes.trim());
  console.log(`${c.gray}------------------------------------------------------${c.reset}\n`);

  if (isDryRun) {
    console.log(`${c.yellow}[Dry Run] 预览演练完成，未发起实际 API 发布与云端内网发布请求。${c.reset}`);
    return;
  }

  // 1. 尝试使用 GitHub API 自动创建或更新 Release 页面
  if (token) {
    console.log(`${c.cyan}[API Publish] 正在通过 GitHub REST API 自动提交 Release 页面 (${targetTag})...${c.reset}`);
    try {
      const payload = {
        tag_name: targetTag,
        name: releaseTitle,
        body: releaseNotes,
        draft: isDraft,
        prerelease: isPrerelease,
      };

      let releaseId = null;
      let htmlUrl = '';

      let res = await sendGitHubAPI('POST', `/repos/${repoInfo.owner}/${repoInfo.repo}/releases`, token, payload);

      if (res.statusCode === 201 && res.data) {
        releaseId = res.data.id;
        htmlUrl = res.data.html_url;
      } else if (res.statusCode === 422 && res.data && res.data.errors && JSON.stringify(res.data.errors).includes('already_exists')) {
        console.log(`${c.yellow}[Release API] 检测到 Tag ${targetTag} 已存在 Release，正在获取 Release ID...${c.reset}`);
        const getRes = await sendGitHubAPI('GET', `/repos/${repoInfo.owner}/${repoInfo.repo}/releases/tags/${targetTag}`, token);
        if (getRes.statusCode === 200 && getRes.data && getRes.data.id) {
          releaseId = getRes.data.id;
          res = await sendGitHubAPI('PATCH', `/repos/${repoInfo.owner}/${repoInfo.repo}/releases/${releaseId}`, token, payload);
          if (res.statusCode === 200 && res.data) {
            htmlUrl = res.data.html_url;
          }
        }
      }

      if (releaseId) {
        if (!htmlUrl) {
          htmlUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/releases/tag/${targetTag}`;
        }
        console.log(`${c.green}✅ Release 基础信息已同步到 GitHub! (Release ID: ${releaseId})${c.reset}`);

        // 2. 纯云端内网秒级直发：通过 GitHub Actions 内部将制品挂载到 Release 页面 (0 本地流量)
        if (cloudInfo.targetRun && cloudInfo.artifacts.length > 0) {
          console.log(`\n${c.cyan}${t('RELEASE_TRIGGERING_CLOUD_DISPATCH', { runId: cloudInfo.targetRun.id })}${c.reset}`);
          const triggerTime = Date.now();
          const dispatchPayload = {
            ref: 'main',
            inputs: {
              tag_name: targetTag,
              run_id: String(cloudInfo.targetRun.id),
            },
          };
          const dispatchRes = await sendGitHubAPI('POST', `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/publish-release.yml/dispatches`, token, dispatchPayload);
          if (dispatchRes.statusCode === 204) {
            console.log(`${c.green}⚡ 已成功向 GitHub Actions 发起云端内网发布指令！${c.reset}`);
            const ok = await waitForCloudPublishRun(repoInfo.owner, repoInfo.repo, token, triggerTime);
            if (ok) {
              console.log(`\n${c.green}${t('RELEASE_CLOUD_PUBLISH_SUCCESS')}${c.reset}`);
            } else {
              console.log(`\n${c.yellow}⚠️ 云端发布流水线已启动，可随时在 GitHub Actions 页面查看挂载进度。${c.reset}`);
            }
          }
        }

        console.log(`\n${c.green}====================================================${c.reset}`);
        console.log(`${c.bold}${c.green}🎉 GitHub Release 发布流程全部完成!${c.reset}`);
        console.log(`${c.bold}📦 Release URL: ${htmlUrl}${c.reset}`);
        console.log(`${c.green}====================================================${c.reset}`);
        return;
      } else {
        console.log(`${c.yellow}[API Request Failed] Status: ${res.statusCode}, Reason: ${JSON.stringify(res.data)}${c.reset}`);
      }
    } catch (e) {
      console.log(`${c.yellow}[API Request Exception] ${e.message}${c.reset}`);
    }
  }

  // 2. 尝试使用 `gh` CLI 自动发布
  const hasGhCli = Boolean(run('gh --version', { ignoreError: true }));
  if (hasGhCli) {
    console.log(`${c.cyan}[CLI Publish] 正在通过 GitHub CLI (gh) 自动创建 Release 及上传资源...${c.reset}`);
    const tmpNotesFile = path.join(__dirname, `../scratch_release_${Date.now()}.md`);
    try {
      fs.writeFileSync(tmpNotesFile, releaseNotes, 'utf-8');

      let ghCmd = `gh release create "${targetTag}" --title "${releaseTitle}" --notes-file "${tmpNotesFile}"`;
      if (isDraft) ghCmd += ' --draft';
      if (isPrerelease) ghCmd += ' --prerelease';

      // 附加资源文件
      for (const assetPath of foundAssets) {
        ghCmd += ` "${assetPath}"`;
      }

      run(ghCmd, { stdio: 'inherit' });

      try { fs.unlinkSync(tmpNotesFile); } catch (_) { }
      if (cacheDirToClean && fs.existsSync(cacheDirToClean)) {
        try { fs.rmSync(cacheDirToClean, { recursive: true, force: true }); } catch (_) { }
      }

      console.log(`\n${c.green}====================================================${c.reset}`);
      console.log(`${c.bold}${c.green}🎉 GitHub Release CLI 自动发布成功!${c.reset}`);
      console.log(`${c.bold}📦 Release URL: https://github.com/${repoInfo.owner}/${repoInfo.repo}/releases/tag/${targetTag}${c.reset}`);
      console.log(`${c.green}====================================================${c.reset}`);
      return;
    } catch (e) {
      try { if (fs.existsSync(tmpNotesFile)) fs.unlinkSync(tmpNotesFile); } catch (_) { }
    }
  }

  console.log(`${c.red}====================================================${c.reset}`);
  console.log(`${c.bold}${c.red}⚠️ 无法自动调用 API: 未检测到 GitHub 授权 Token${c.reset}`);
  console.log(`${c.yellow}💡 请在项目根目录的 .env 文件中配置你的 GITHUB_TOKEN:${c.reset}`);
  console.log(`${c.cyan}   GITHUB_TOKEN=ghp_YourPersonalAccessTokenHere${c.reset}`);
  console.log(`${c.red}====================================================${c.reset}`);
}

main().catch((err) => {
  console.error(`${c.red}[Release Error] ${err.message}${c.reset}`);
  process.exit(1);
});

