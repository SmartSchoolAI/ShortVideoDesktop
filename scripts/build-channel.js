/**
 * ShortVideoDesktop 多版本 (A / B / C) 打包控制脚本
 * 
 * 规范：
 * - Windows 分别打包出 A、B、C 三个版本，分别使用不同安装与数据目录、带独立颜色圆点图标与单实例锁，互不影响；
 * - Mac 与 Linux 统一使用 A 版本。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const BASE_CONFIG_FILE = path.join(ROOT_DIR, 'electron-builder.json');

const CHANNELS = {
  a: {
    key: 'A',
    productName: 'ShortVideo A',
    appId: 'com.smartschoolai.shortvideo.a',
    iconIco: 'build/icon-a.ico',
    iconPng: 'build/icon-a.png',
    scheme: 'shortvideo-a',
    description: 'ShortVideo Desktop Client (Channel A - Green Edition)',
  },
  b: {
    key: 'B',
    productName: 'ShortVideo B',
    appId: 'com.smartschoolai.shortvideo.b',
    iconIco: 'build/icon-b.ico',
    iconPng: 'build/icon-b.png',
    scheme: 'shortvideo-b',
    description: 'ShortVideo Desktop Client (Channel B - Amber Edition)',
  },
  c: {
    key: 'C',
    productName: 'ShortVideo C',
    appId: 'com.smartschoolai.shortvideo.c',
    iconIco: 'build/icon-c.ico',
    iconPng: 'build/icon-c.png',
    scheme: 'shortvideo-c',
    description: 'ShortVideo Desktop Client (Channel C - Magenta Edition)',
  },
};

function runStep(cmd, args, description) {
  console.log(`\n⏳ ${description}...`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
  });
  if (res.status !== 0) {
    console.error(`❌ 执行失败: ${description} (退出码: ${res.status})`);
    process.exit(res.status || 1);
  }
}

// 检查并自动生成各版本图标
function ensureIcons() {
  const missing = ['a', 'b', 'c'].some((ch) => {
    return (
      !fs.existsSync(path.join(ROOT_DIR, CHANNELS[ch].iconIco)) ||
      !fs.existsSync(path.join(ROOT_DIR, CHANNELS[ch].iconPng))
    );
  });

  if (missing) {
    console.log('🎨 正在生成 A / B / C 版本的独立圆点图标...');
    const psScript = path.join(ROOT_DIR, 'scripts', 'generate-channel-icons.ps1');
    if (fs.existsSync(psScript)) {
      runStep('powershell', ['-ExecutionPolicy', 'Bypass', '-File', `"${psScript}"`], '生成分身彩色圆点图标');
    }
  }
}

function buildChannel(channelKey, extraArgs = []) {
  const ch = CHANNELS[channelKey];
  if (!ch) {
    console.error(`❌ 未知的版本标识: ${channelKey}，仅支持 a, b, c, all`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`🚀 开始打包 ShortVideo 版本 [${ch.key}] -> ${ch.productName}`);
  console.log(`🆔 App ID: ${ch.appId}`);
  console.log(`🎨 图标: ${ch.iconIco}`);
  console.log(`======================================================`);

  // 读取基础配置并注入定制属性
  const baseConfig = JSON.parse(fs.readFileSync(BASE_CONFIG_FILE, 'utf8'));

  // 将当前版本渠道元数据写入 dist-electron/channel.json 确保随包打包进 asar
  const distElectronDir = path.join(ROOT_DIR, 'dist-electron');
  if (!fs.existsSync(distElectronDir)) {
    fs.mkdirSync(distElectronDir, { recursive: true });
  }
  const channelMeta = {
    channel: ch.key,
    productName: ch.productName,
    appId: ch.appId,
  };
  fs.writeFileSync(path.join(distElectronDir, 'channel.json'), JSON.stringify(channelMeta, null, 2), 'utf8');

  const channelConfig = {
    ...baseConfig,
    appId: ch.appId,
    productName: ch.productName,
    extraMetadata: {
      channel: ch.key,
      appId: ch.appId,
      productName: ch.productName,
    },
    publish: (baseConfig.publish || []).map((p) => ({
      ...p,
      updaterCacheDirName: `shortvideo/update-${ch.key.toLowerCase()}`,
    })),
    protocols: [
      {
        name: `${ch.productName} Protocol`,
        schemes: ch.key === 'A' ? [ch.scheme, 'shortvideo'] : [ch.scheme],
      },
    ],
    nsis: {
      ...baseConfig.nsis,
      shortcutName: ch.productName,
      uninstallDisplayName: ch.productName,
    },
    win: {
      ...baseConfig.win,
      icon: ch.iconIco,
      executableName: ch.productName,
      artifactName: `${ch.productName.replace(/\s+/g, '-')}-Setup-\${version}.\${ext}`,
    },
    mac: {
      ...baseConfig.mac,
      // Mac 统一使用 A 版本图标
      icon: CHANNELS.a.iconPng,
    },
    linux: {
      ...baseConfig.linux,
      // Linux 统一使用 A 版本图标
      icon: CHANNELS.a.iconPng,
    },
  };

  const tempConfigFile = path.join(ROOT_DIR, `electron-builder.${channelKey}.temp.json`);
  fs.writeFileSync(tempConfigFile, JSON.stringify(channelConfig, null, 2), 'utf8');

  try {
    const builderArgs = ['electron-builder', '--config', `"${tempConfigFile}"`, ...extraArgs];
    runStep('npx', builderArgs, `执行 electron-builder 打包 [${ch.key}]`);
  } finally {
    try {
      if (fs.existsSync(tempConfigFile)) {
        fs.unlinkSync(tempConfigFile);
      }
    } catch (_) {}
  }

  console.log(`✅ [${ch.key}] 版本打包成功！`);
}

function main() {
  const argv = process.argv.slice(2);
  const target = (argv[0] || 'a').toLowerCase();
  const extraArgs = argv.slice(1).filter((arg) => !['a', 'b', 'c', 'all'].includes(arg.toLowerCase()));

  // 1. 清理并编译 TypeScript 与资源复制
  runStep('node', ['scripts/clean-electron.js'], '清理历史编译构建缓存');
  runStep('npx', ['tsc', '-p', 'tsconfig.json'], '编译主进程 TypeScript');
  runStep('npx', ['tsc', '-p', 'tsconfig.render.json'], '编译渲染进程 TypeScript');
  runStep('node', ['scripts/copy-electron-views.js'], '复制前端 HTML 视图资源');

  // 2. 确保图标齐全
  ensureIcons();

  // 3. 执行打包
  if (target === 'all') {
    // 批量打包 Windows A, B, C 三个版本
    console.log('\n📦 即将依次打包 Windows A、B、C 三个版本...');
    buildChannel('a', ['--win', ...extraArgs]);
    buildChannel('b', ['--win', ...extraArgs]);
    buildChannel('c', ['--win', ...extraArgs]);
    console.log('\n🎉 所有版本 (A、B、C) 均已成功打包输出！输出目录: dist-release/');
  } else {
    buildChannel(target, extraArgs);
  }
}

main();
