const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { t } = require('./i18n');

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

console.log(t('CLEAN_ELECTRON_START'));

// 1. 终止残留的客户端主进程与 Electron 调试进程
killProcess('ShortVideo.exe');
killProcess('electron.exe');

// 2. 清理 release 产物目录与 dist-electron 编译目录
removeDirSafe('release');
removeDirSafe('dist-electron');

console.log(t('CLEAN_ELECTRON_DONE'));

