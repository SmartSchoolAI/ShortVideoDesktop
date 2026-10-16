/**
 * 本地多版本开发调试启动器
 * 允许在开发环境下同时启动 A、B、C 三个不同版本的实例进行并发联调
 */
const { spawn } = require('child_process');
const path = require('path');
const { t } = require('./i18n');

const channel = (process.argv[2] || 'A').toUpperCase();
console.log(`\n${t('DEV_CHANNEL_START', { channel })}`);

const ROOT_DIR = path.resolve(__dirname, '..');

const child = spawn('npx', ['electron', 'dist-electron/main.js'], {
  cwd: ROOT_DIR,
  env: {
    ...process.env,
    SHORTVIDEO_CHANNEL: channel,
  },
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
