const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let t = (key, params) => {
  if (key === 'CLEAN_ELECTRON_START') return '[clean-electron] Cleaning legacy Electron processes and build cache...';
  if (key === 'CLEAN_ELECTRON_DONE') return '[clean-electron] Build cache cleaned successfully.';
  if (key === 'CLEAN_ELECTRON_WARN_LOCK') return `[clean-electron] Warning: Directory ${params?.dir} is locked by another process: ${params?.err}`;
  return key;
};

try {
  const i18n = require('./i18n');
  if (i18n && typeof i18n.t === 'function') {
    t = i18n.t;
  }
} catch (_) {}

function killProcess(processName) {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /IM ${processName} /T`, { stdio: 'ignore' });
    } catch {}
  }
}

function removeDirSafe(dirPath, maxRetries = 5, delayMs = 600) {
  const fullPath = path.resolve(__dirname, '..', dirPath);
  if (!fs.existsSync(fullPath)) return;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 400 });
      if (!fs.existsSync(fullPath)) {
        return;
      }
    } catch (err) {
      if (attempt === maxRetries) {
        console.warn(t('CLEAN_ELECTRON_WARN_LOCK', { dir: dirPath, err: err.message }));
        return;
      }
    }
    // 短暂等待文件句柄释放
    const start = Date.now();
    while (Date.now() - start < delayMs) {}
  }
}

function getOutputDir() {
  try {
    const builderConfigPath = path.resolve(__dirname, '..', 'electron-builder.json');
    if (fs.existsSync(builderConfigPath)) {
      const config = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'));
      if (config.directories && config.directories.output) {
        return config.directories.output;
      }
    }
  } catch {}
  return 'dist-release';
}

console.log(t('CLEAN_ELECTRON_START'));

// 1. 终止残留的客户端主进程与 Electron 调试进程
killProcess('ShortVideo.exe');
killProcess('electron.exe');

// 2. 动态读取配置并清理输出产物目录与编译目录
const outputDir = getOutputDir();
removeDirSafe(outputDir);
removeDirSafe('dist-electron');

// 3. 静默清理历史遗留 release 目录 (避免防病毒软件占用产生非必要告警)
if (outputDir !== 'release') {
  try {
    const legacyPath = path.resolve(__dirname, '..', 'release');
    if (fs.existsSync(legacyPath)) {
      fs.rmSync(legacyPath, { recursive: true, force: true, maxRetries: 1 });
    }
  } catch {}
}

console.log(t('CLEAN_ELECTRON_DONE'));

