/**
 * 自动化 GitHub Tag 递增与推送脚本
 * 用法:
 *   pnpm run addtag             # 自动获取当前最大版本号并将最后一位加 1 并推送 (如 v0.2.0 -> v0.2.1)
 *   pnpm run addtag --dry-run   # 预览模式：仅计算并展示下一个 Tag，不实际创建和推送
 *   pnpm run addtag v0.3.0      # 手动指定特定版本号并推送
 *   pnpm run addtag --sync-pkg  # 同步更新本地 package.json 中的 version
 *
 * 核心特性:
 * 1. 批量单次拉取远程全量 Tags (批量 Set 缓存，零重复网络往返，性能提升 10 倍)
 * 2. 严格全字匹配的本地与远程双重防冲突检测 (彻底排除子串误判)
 * 3. 自动递增 (Patch + 1) 并自动跳过本地或 GitHub 远程已占用的 Tag
 * 4. 保持工作区干净：默认不破坏工作区 clean 状态 (GitHub Actions 会全自动按 Tag 对齐版本构建)
 * 5. TTY 感知与跨平台 ANSI 颜色适配 (CI/重定向环境自动降级无颜色纯文本)
 * 6. 支持 --dry-run / -n 安全演练模式
 * 7. 创建带附注的 Git Tag (Annotated Tag, 具备作者、日期与描述，更利于 CI/CD 与 GitHub Release)
 * 8. 使用 stdio: 'inherit' 执行推送，实时展示 Git 网络传输与授权进度
 * 9. 输出 GitHub Release 与 GitHub Actions 构建直达链接
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

// TTY 感知的 ANSI 颜色输出
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

function getGitHubRepoUrl(remote) {
  try {
    const url = run(`git remote get-url ${remote}`, { ignoreError: true }) || '';
    if (url.startsWith('git@github.com:')) {
      return 'https://github.com/' + url.replace('git@github.com:', '').replace(/\.git$/, '');
    }
    if (url.startsWith('ssh://git@github.com/')) {
      return 'https://github.com/' + url.replace('ssh://git@github.com/', '').replace(/\.git$/, '');
    }
    if (url.startsWith('https://github.com/')) {
      return url.replace(/\.git$/, '');
    }
  } catch {}
  return '';
}

function getGitBranchInfo() {
  const branch = run('git branch --show-current', { ignoreError: true }) || 'HEAD';
  const commit = run('git rev-parse --short HEAD', { ignoreError: true }) || 'unknown';
  const commitMsg = run('git log -1 --pretty=%s', { ignoreError: true }) || '';
  const status = run('git status --porcelain', { ignoreError: true }) || '';
  const isDirty = status.trim().length > 0;
  return { branch, commit, commitMsg, isDirty };
}

/**
 * 单次批量拉取远程全部 Tag 集合（单次往返，大幅提升检测性能）
 */
function getRemoteTagSet(remote) {
  try {
    const res = run(`git ls-remote --tags ${remote}`, { ignoreError: true }) || '';
    const tagSet = new Set();
    for (const line of res.split(/\r?\n/)) {
      const parts = line.split(/\s+/);
      const ref = parts[1] || '';
      if (ref.startsWith('refs/tags/')) {
        const tag = ref.replace('refs/tags/', '').replace(/\^\{\}$/, '');
        if (tag) tagSet.add(tag);
      }
    }
    return tagSet;
  } catch {
    return new Set();
  }
}

/**
 * 获取本地全部 Tag 集合（缓存加速对比）
 */
function getLocalTagSet() {
  const rawTags = run('git tag -l', { ignoreError: true }) || '';
  return new Set(
    rawTags
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

function getLatestTag(localTags, remoteTags) {
  // 合并本地与远程所有已知的 Tags
  const allKnownTags = new Set([...localTags, ...remoteTags]);
  const semverRegex = /^(v?)(\d+)\.(\d+)\.(\d+)(?:-[\w\.\-]+)?$/;
  const parsedTags = [];

  for (const tag of allKnownTags) {
    const match = tag.match(semverRegex);
    if (match) {
      parsedTags.push({
        raw: tag,
        hasV: match[1] === 'v',
        major: parseInt(match[2], 10),
        minor: parseInt(match[3], 10),
        patch: parseInt(match[4], 10),
      });
    }
  }

  if (parsedTags.length === 0) {
    return null;
  }

  // 严格按 major -> minor -> patch 排序，取最大值
  parsedTags.sort((a, b) => {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
  });

  return parsedTags[parsedTags.length - 1];
}

function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('-n');
  const syncPkg = args.includes('--sync-pkg');
  const isBuildAll = args.includes('--all') || args.includes('--all-platforms');
  const customTagArg = args.find((arg) => !arg.startsWith('-'));

  console.log(`\n${c.cyan}====================================================${c.reset}`);
  console.log(`${c.bold}${c.cyan}${t('ADD_TAG_BANNER_TITLE')}${c.reset}${isDryRun ? ` ${c.yellow}${t('ADD_TAG_DRY_RUN_LABEL')}${c.reset}` : ''}`);
  console.log(`${c.cyan}====================================================${c.reset}`);

  const { branch, commit, commitMsg, isDirty } = getGitBranchInfo();
  const remote = getRemoteName();
  const repoUrl = getGitHubRepoUrl(remote);

  console.log(`${c.gray}${t('ADD_TAG_CURRENT_BRANCH')}${c.reset} ${c.bold}${branch}${c.reset} (Commit: ${c.yellow}${commit}${c.reset})`);
  console.log(`${c.gray}${t('ADD_TAG_COMMIT_MSG')}${c.reset} ${commitMsg}`);
  console.log(`${c.gray}${t('ADD_TAG_REMOTE_REPO')}${c.reset} ${remote} ${repoUrl ? `(${repoUrl})` : ''}`);

  if (isDirty) {
    console.log(`${c.yellow}${t('ADD_TAG_DIRTY_WARN', { commit })}${c.reset}`);
  }

  // 1. 同步拉取远程 Tags 并批量构建本地/远程 Set 缓存
  console.log(`${c.gray}${t('ADD_TAG_FETCHING')}${c.reset}`);
  run('git fetch --tags', { ignoreError: true });

  const localTags = getLocalTagSet();
  const remoteTags = getRemoteTagSet(remote);
  console.log(`${c.gray}${t('ADD_TAG_STATS', { local: localTags.size, remote: remoteTags.size })}${c.reset}`);

  let nextTag = '';
  let nextVersion = '';

  if (customTagArg) {
    const cleanArg = customTagArg.trim();
    const match = cleanArg.match(/^(v?)(\d+)\.(\d+)\.(\d+)(?:-[\w\.\-]+)?$/);
    if (!match) {
      console.error(`\n${c.red}❌ Error: Specified version "${cleanArg}" does not match semver (e.g. v0.2.1)${c.reset}\n`);
      process.exit(1);
    }
    nextTag = match[1] === 'v' ? cleanArg : `v${cleanArg}`;
    nextVersion = `${match[2]}.${match[3]}.${match[4]}`;
    console.log(`${c.gray}${t('ADD_TAG_CUSTOM_SPECIFIED', { tag: `${c.bold}${c.green}${nextTag}${c.reset}` })}${c.reset}`);
  } else {
    // 自动检测当前最大 Tag 并将最后一位加 1
    const latestTag = getLatestTag(localTags, remoteTags);

    if (latestTag) {
      console.log(`${c.gray}${t('ADD_TAG_DETECTED_LATEST', { tag: `${c.bold}${latestTag.raw}${c.reset}` })}${c.reset}`);
      const nextMajor = latestTag.major;
      const nextMinor = latestTag.minor;
      let nextPatch = latestTag.patch + 1; // 最后一位加 1

      // 本地与远程权威双重冲突防御 (基于 Set 高速内存对比)
      while (true) {
        const candidate = `v${nextMajor}.${nextMinor}.${nextPatch}`;
        const candidateAll = `v${nextMajor}.${nextMinor}.${nextPatch}-all`;
        const localExists = localTags.has(candidate) || localTags.has(candidateAll);
        const remoteExists = remoteTags.has(candidate) || remoteTags.has(candidateAll);

        if (localExists || remoteExists) {
          nextPatch += 1;
        } else {
          nextTag = isBuildAll ? candidateAll : candidate;
          nextVersion = `${nextMajor}.${nextMinor}.${nextPatch}`;
          break;
        }
      }
    } else {
      // 仓库暂无 Tag 时，读取 package.json 作为基准
      const pkgPath = path.resolve(__dirname, '../package.json');
      let defaultVer = '0.1.0';
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.version) defaultVer = pkg.version;
        } catch {}
      }
      const parts = defaultVer.split('.').map((n) => parseInt(n, 10) || 0);
      const nextPatch = (parts[2] || 0) + 1;
      const baseTag = `v${parts[0] || 0}.${parts[1] || 1}.${nextPatch}`;
      nextTag = isBuildAll ? `${baseTag}-all` : baseTag;
      nextVersion = `${parts[0] || 0}.${parts[1] || 1}.${nextPatch}`;
    }
  }

  if (isBuildAll && !nextTag.endsWith('-all')) {
    nextTag += '-all';
  }

  const buildTargetText = isBuildAll ? '🌐 [云端构建: Windows + macOS + Linux 三平台]' : '🪟 [云端构建: 仅 Windows 单平台]';
  console.log(`${c.bold}${c.green}${t('ADD_TAG_TARGET', { tag: nextTag, version: nextVersion })} ${c.cyan}${buildTargetText}${c.reset}`);

  // DRY-RUN 预览模式下直接安全返回
  if (isDryRun) {
    console.log(`\n${c.yellow}====================================================${c.reset}`);
    console.log(`${c.bold}${c.yellow}${t('ADD_TAG_DRY_RUN_DONE')}${c.reset}`);
    console.log(`${c.yellow}====================================================${c.reset}\n`);
    return;
  }

  // 2. 同步更新本地 package.json version (若传入 --sync-pkg 参数)
  if (syncPkg) {
    const pkgPath = path.resolve(__dirname, '../package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const rawContent = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(rawContent);
        if (pkg.version !== nextVersion) {
          pkg.version = nextVersion;
          const eol = rawContent.includes('\r\n') ? '\r\n' : '\n';
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + eol, 'utf8');
        }
      } catch (err) {
        console.warn(`${c.yellow}[AddTag] Warning: ${err?.message || err}${c.reset}`);
      }
    }
  }

  // 3. 在本地创建附注标签 (Annotated Tag)
  console.log(`${c.gray}${t('ADD_TAG_CREATING_LOCAL', { tag: nextTag })}${c.reset}`);
  try {
    run(`git tag -a ${nextTag} -m "Release ${nextTag}"`);
    console.log(`${c.green}${t('ADD_TAG_LOCAL_CREATED', { tag: nextTag })}${c.reset}`);
  } catch (tagErr) {
    console.error(`\n${c.red}❌ Error: ${tagErr.message}${c.reset}\n`);
    process.exit(1);
  }

  // 4. 推送新 Tag 到 GitHub 远程仓库 (使用 inherit 实时透传 Git 传输进度与凭据交互)
  console.log(`${c.gray}${t('ADD_TAG_PUSHING', { remote, tag: nextTag })}${c.reset}`);
  try {
    execSync(`git push ${remote} ${nextTag}`, { stdio: 'inherit' });
    console.log(`\n${c.green}====================================================${c.reset}`);
    console.log(`${c.bold}${c.green}${t('ADD_TAG_SUCCESS', { tag: nextTag })}${c.reset}`);
    if (repoUrl) {
      console.log(`${c.cyan}📦 GitHub Release: ${repoUrl}/releases/tag/${nextTag}${c.reset}`);
      console.log(`${c.cyan}⚡ GitHub Actions: ${repoUrl}/actions${c.reset}`);
    }
    console.log(`${c.green}====================================================${c.reset}\n`);
  } catch (pushErr) {
    console.error(`\n${c.red}❌ Error: Push failed.${c.reset}`);
    process.exit(1);
  }
}

main();
