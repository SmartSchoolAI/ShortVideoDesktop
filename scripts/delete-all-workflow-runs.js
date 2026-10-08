#!/usr/bin/env node

/**
 * 自动删除 GitHub 仓库中所有历史 Workflow Runs 和 Artifacts
 * 支持本地命令行运行与 GitHub Actions CI 中自动化运行
 *
 * 用法:
 *   node scripts/delete-all-workflow-runs.js [--repo=owner/repo] [--token=ghp_xxx]
 */

const { execSync } = require('child_process');
const { t } = require('./i18n');

function getArg(flag) {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.split('=')[1] : null;
}

// 1. 获取 GitHub Token
const token =
  getArg('token') ||
  process.env.GITHUB_TOKEN ||
  process.env.GH_TOKEN ||
  process.env.GITHUB_PAT;

if (!token) {
  console.error('\x1b[31m[Error] GITHUB_TOKEN not found.\x1b[0m');
  console.error('Please pass via export GITHUB_TOKEN=your_pat or --token=your_pat.');
  process.exit(1);
}

// 2. 解析仓库 owner/repo
function resolveRepo() {
  const argRepo = getArg('repo') || process.env.GITHUB_REPOSITORY;
  if (argRepo) return argRepo.trim();

  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  } catch (e) {
    // 忽略 git 报错
  }

  return 'SmartSchoolAI/ShortVideoDesktop';
}

const targetRepo = resolveRepo();
console.log(`\x1b[36m[CleanWorkflows] 目标仓库: ${targetRepo}\x1b[0m`);

// 当前正在运行的 Run ID（如果在 CI 中执行，保护当前正在运行的任务）
const currentRunId = process.env.GITHUB_RUN_ID ? String(process.env.GITHUB_RUN_ID) : null;
if (currentRunId) {
  console.log(`[CleanWorkflows] 当前 CI Run ID 为 ${currentRunId}，将跳过删除当前任务。`);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'ShortVideo-Cleanup-Script',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function apiFetch(path, options = {}) {
  const url = `https://api.github.com/repos/${targetRepo}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`API 请求失败 [${res.status}] ${url}: ${errorText}`);
  }

  if (res.status === 204) return null;
  return await res.json();
}

/**
 * 清理所有制品 (Artifacts)
 */
async function cleanArtifacts() {
  console.log('\n🔍 [1/2] Fetching & cleaning legacy build artifacts...');
  let deletedCount = 0;

  try {
    while (true) {
      const data = await apiFetch('/actions/artifacts?per_page=100');
      const artifacts = data.artifacts || [];
      if (artifacts.length === 0) break;

      console.log(`Found ${artifacts.length} artifacts, deleting one by one...`);
      for (const artifact of artifacts) {
        try {
          await apiFetch(`/actions/artifacts/${artifact.id}`, { method: 'DELETE' });
          console.log(`  ✓ Deleted artifact: ${artifact.name} (ID: ${artifact.id}, Size: ${(artifact.size_in_bytes / 1024 / 1024).toFixed(1)} MB)`);
          deletedCount++;
        } catch (err) {
          console.warn(`  ⚠️ Failed to delete artifact ${artifact.id}:`, err.message);
        }
      }

      if (artifacts.length < 100) break;
    }
    console.log(`✅ Artifacts cleanup completed. Deleted ${deletedCount} artifacts.`);
  } catch (err) {
    console.warn('⚠️ Exception during artifacts cleanup:', err.message);
  }
}

/**
 * 清理所有历史 Workflow Runs
 */
async function cleanWorkflowRuns() {
  console.log('\n🔍 [2/2] Fetching & cleaning legacy Actions / Workflow Runs...');
  let deletedCount = 0;

  try {
    while (true) {
      const data = await apiFetch('/actions/runs?per_page=100');
      const runs = data.workflow_runs || [];
      if (runs.length === 0) break;

      // 过滤出需要删除的 runs（保留当前执行中的 run）
      const toDelete = runs.filter((r) => String(r.id) !== currentRunId);
      if (toDelete.length === 0) {
        console.log('Only current running workflow remains, cleanup completed.');
        break;
      }

      console.log(`Found ${toDelete.length} legacy Workflow Runs, deleting one by one...`);
      for (const run of toDelete) {
        try {
          await apiFetch(`/actions/runs/${run.id}`, { method: 'DELETE' });
          console.log(`  ✓ Deleted Run #${run.run_number}: ${run.name} (ID: ${run.id}, Status: ${run.status}, Conclusion: ${run.conclusion || 'running'})`);
          deletedCount++;
        } catch (err) {
          console.warn(`  ⚠️ Failed to delete Run ${run.id}:`, err.message);
        }
      }

      // 如果本批次全部被跳过或不足 100 条，结束循环
      if (runs.length < 100) break;
    }

    console.log(`✅ Workflow Runs cleanup completed. Deleted ${deletedCount} records.`);
  } catch (err) {
    console.warn('⚠️ Exception during workflow runs cleanup:', err.message);
  }
}

async function main() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('🚀 Starting GitHub Actions Workflow Runs & Artifacts Cleanup');
  console.log('====================================================');

  await cleanArtifacts();
  await cleanWorkflowRuns();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n====================================================');
  console.log(`🎉 Cleanup workflow completed! Time elapsed: ${elapsed}s`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('\x1b[31m[Fatal Error]\x1b[0m', err);
  process.exit(1);
});
