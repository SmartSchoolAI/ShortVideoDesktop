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

function getReleaseAssets() {
  const releaseDir = path.resolve(process.cwd(), 'release');
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

  const foundAssets = getReleaseAssets();

  console.log(`${c.bold}[Release Target]${c.reset}  : ${c.yellow}${targetTag}${c.reset}`);
  console.log(`${c.bold}[Previous Tag]${c.reset}    : ${c.gray}${prevTag || 'None'}${c.reset}`);
  console.log(`${c.bold}[Commit Count]${c.reset}    : ${c.cyan}${commits.length}${c.reset}`);
  console.log(`${c.bold}[Repository]${c.reset}      : ${c.blue}${repoInfo.owner}/${repoInfo.repo}${c.reset}`);
  console.log(`${c.bold}[Assets Found]${c.reset}    : ${c.green}${foundAssets.length} 个安装包资源${c.reset}\n`);

  if (foundAssets.length > 0) {
    for (const assetPath of foundAssets) {
      const stats = fs.statSync(assetPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`  📦 [Asset] ${path.basename(assetPath)} (${sizeMB} MB)`);
    }
    console.log('');
  }

  console.log(`${c.gray}---------------- Release Notes Preview ----------------${c.reset}`);
  console.log(releaseNotes.trim());
  console.log(`${c.gray}------------------------------------------------------${c.reset}\n`);

  if (isDryRun) {
    console.log(`${c.yellow}[Dry Run] 预览演练完成，未发起实际 API 发布与安装包上传请求。${c.reset}`);
    return;
  }

  const token = findGitHubToken();

  // 1. 尝试使用 GitHub API 自动创建或更新 Release
  if (token) {
    console.log(`${c.cyan}[API Publish] 正在通过 GitHub REST API 自动提交 Release (${targetTag})...${c.reset}`);
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
        console.log(`${c.green}✅ Release 信息已同步到 GitHub! (Release ID: ${releaseId})${c.reset}`);

        // 开始上传安装包资源
        if (foundAssets.length > 0) {
          console.log(`\n${c.cyan}[Assets Upload] 正在上传 ${foundAssets.length} 个安装包附件到 Release...${c.reset}`);
          for (const assetPath of foundAssets) {
            await uploadReleaseAsset(repoInfo.owner, repoInfo.repo, releaseId, assetPath, token);
          }
        }

        // 如果指定了 --dispatch 选项，通过 API 自动触发 GitHub Actions 编译 Windows/macOS/Linux 三平台包
        if (isDispatch) {
          console.log(`\n${c.cyan}[Actions Dispatch] 正在触发 GitHub Actions 三平台 (Windows/macOS/Linux) 云端并行构建流水线...${c.reset}`);
          const dispatchPayload = {
            ref: 'main',
            inputs: {
              platform: 'all',
              create_release: true,
              tag_name: targetTag,
            },
          };
          const dispatchRes = await sendGitHubAPI('POST', `/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/build-electron.yml/dispatches`, token, dispatchPayload);
          if (dispatchRes.statusCode === 204) {
            console.log(`${c.green}⚡ 已成功触发 GitHub Actions 多平台自动化构建工作流!${c.reset}`);
            console.log(`${c.gray}   构建完成后将自动汇总上传 Windows、macOS 及 Linux 三端安装包至当前 Release。${c.reset}`);
          }
        }

        console.log(`\n${c.green}====================================================${c.reset}`);
        console.log(`${c.bold}${c.green}🎉 GitHub Release API 自动生成与安装包资源上传成功!${c.reset}`);
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

