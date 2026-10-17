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
const { t } = require('./i18n');

const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const BASE_CONFIG_FILE = path.join(ROOT_DIR, 'electron-builder.json');

const CHANNELS = {
  a: {
    key: 'A',
    productName: 'ShortVideo A',
    appId: 'com.smartschoolai.shortvideo.a',
    iconPng: 'build/icon-a.png',
    scheme: 'shortvideo-a',
    description: 'ShortVideo Desktop Client (Channel A - Green Edition)',
  },
  b: {
    key: 'B',
    productName: 'ShortVideo B',
    appId: 'com.smartschoolai.shortvideo.b',
    iconPng: 'build/icon-b.png',
    scheme: 'shortvideo-b',
    description: 'ShortVideo Desktop Client (Channel B - Amber Edition)',
  },
  c: {
    key: 'C',
    productName: 'ShortVideo C',
    appId: 'com.smartschoolai.shortvideo.c',
    iconPng: 'build/icon-c.png',
    scheme: 'shortvideo-c',
    description: 'ShortVideo Desktop Client (Channel C - Magenta Edition)',
  },
};

function runStep(cmd, args, description) {
  console.log(`\n${t('BUILD_CHANNEL_STEP_START', { desc: description })}`);
  const res = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
  });
  if (res.status !== 0) {
    console.error(t('BUILD_CHANNEL_STEP_FAILED', { desc: description, code: res.status }));
    process.exit(res.status || 1);
  }
}

// 自动检测并修复 electron-builder 官方 icons 转换工具的并发竞态与 WebAssembly.Memory 1GB OOM 崩溃 Bug
function ensureBuilderWasmPatched() {
  try {
    const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
    if (!localAppData) return;
    const iconsCacheDir = path.join(localAppData, 'electron-builder', 'Cache', 'icons@1.1.0');
    if (!fs.existsSync(iconsCacheDir)) return;

    const subDirs = fs.readdirSync(iconsCacheDir);
    for (const sub of subDirs) {
      const toolFile = path.join(iconsCacheDir, sub, 'icon-tool.js');
      if (fs.existsSync(toolFile)) {
        let code = fs.readFileSync(toolFile, 'utf8');
        let modified = false;

        // 1. 修复单例竞态
        if (!code.includes('var vipsPromise = null;')) {
          code = code.replace(
            /var vipsInstance = null;\s*async function getVips\(\) \{[\s\S]*?return vipsInstance;\s*\}/,
            `var vipsPromise = null;\nfunction getVips() {\n  if (!vipsPromise) {\n    vipsPromise = VipsFactory({ dynamicLibraries: [] });\n  }\n  return vipsPromise;\n}`
          );
          modified = true;
        }

        // 2. 针对 Windows 环境：优先使用系统原生轻量图像引擎处理 ICO 转换，彻底杜绝 WebAssembly 1GB 虚拟内存申请失败导致的 OOM 崩溃
        if (!code.includes('// PATCHED_NATIVE_ICO_GENERATOR_V2')) {
          const nativeIcoPatch = `// PATCHED_NATIVE_ICO_GENERATOR_V2
async function createIco(inputBuffer, outputDir) {
  if (process.platform === 'win32') {
    try {
      const { spawnSync } = require('child_process');
      const tempSrc = (0, import_path4.join)(outputDir, '__raw_source.png');
      const tempPs1 = (0, import_path4.join)(outputDir, '__resizer.ps1');
      (0, import_fs4.writeFileSync)(tempSrc, inputBuffer);
      const psContent = [
        'Add-Type -AssemblyName System.Drawing',
        '$img = [System.Drawing.Image]::FromFile($args[0])',
        '$sizes = @(16, 24, 32, 48, 64, 128, 256)',
        'foreach ($s in $sizes) {',
        '  $bmp = New-Object System.Drawing.Bitmap($img, $s, $s)',
        '  $dest = Join-Path $args[1] ($s.ToString() + \".png\")',
        '  $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)',
        '  $bmp.Dispose()',
        '}',
        '$img.Dispose()'
      ].join('\\r\\n');
      (0, import_fs4.writeFileSync)(tempPs1, psContent, 'utf8');
      const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempPs1, tempSrc, outputDir], { windowsHide: true });
      if (res.status === 0) {
        const frames = [];
        for (const size of ICO_SIZES) {
          const frameFile = (0, import_path4.join)(outputDir, size + '.png');
          if ((0, import_fs4.existsSync)(frameFile)) {
            frames.push({ size, png: (0, import_fs4.readFileSync)(frameFile) });
            try { (0, import_fs4.unlinkSync)(frameFile); } catch (_) {}
          }
        }
        try { (0, import_fs4.unlinkSync)(tempSrc); } catch (_) {}
        try { (0, import_fs4.unlinkSync)(tempPs1); } catch (_) {}
        if (frames.length === ICO_SIZES.length) {
          (0, import_fs4.writeFileSync)((0, import_path4.join)(outputDir, "icon.ico"), packIco(frames));
          return;
        }
      }
    } catch (_) {}
  }
  const frames = await Promise.all(
    ICO_SIZES.map(async (size) => ({ size, png: await resizeWithLanczos(inputBuffer, size) }))
  );
  (0, import_fs4.writeFileSync)((0, import_path4.join)(outputDir, "icon.ico"), packIco(frames));
}`;
          code = code.replace(
            /(?:\/\/\s*PATCHED_NATIVE_ICO_GENERATOR[\s\S]*?)?async function createIco\(inputBuffer, outputDir\) \{[\s\S]*?\(0, import_fs4\.writeFileSync\)\(\(0, import_path4\.join\)\(outputDir, "icon\.ico"\), packIco\(frames\)\);\s*\}/,
            nativeIcoPatch
          );
          modified = true;
        }

        if (modified) {
          fs.writeFileSync(toolFile, code, 'utf8');
        }
      }
    }
  } catch (_) {}
}

// 确保各渠道高清晰度原始 PNG 图标文件存在
function ensureIcons() {
  ensureBuilderWasmPatched();
  const missing = ['a', 'b', 'c'].some((ch) => {
    return !fs.existsSync(path.join(ROOT_DIR, CHANNELS[ch].iconPng));
  });

  if (missing) {
    console.warn(t('BUILD_CHANNEL_MISSING_ICON'));
  } else {
    console.log(t('BUILD_CHANNEL_CONFIRMED_ICON'));
  }
}

function cleanupProcessLocks() {
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/F', '/IM', 'ShortVideo*.exe', '/T'], { stdio: 'ignore' });
    } catch {}
    try {
      spawnSync('taskkill', ['/F', '/IM', '*Setup*.exe', '/T'], { stdio: 'ignore' });
    } catch {}
  }
}

function syncArtifactsToRoot(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  if (!fs.existsSync(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
  }
  const files = fs.readdirSync(srcDir);
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dst = path.join(dstDir, f);
    if (fs.statSync(src).isFile()) {
      try {
        fs.copyFileSync(src, dst);
      } catch (err) {
        console.warn(`[Build] 同步产物 ${f} 到根输出目录提示:`, err.message);
      }
    }
  }
}

function buildChannel(channelKey, extraArgs = []) {
  const ch = CHANNELS[channelKey];
  if (!ch) {
    console.error(t('BUILD_CHANNEL_UNKNOWN_KEY', { key: channelKey }));
    process.exit(1);
  }

  // 1. 打包前清理可能残留的文件句柄与相关进程
  cleanupProcessLocks();

  console.log(`\n======================================================`);
  console.log(t('BUILD_CHANNEL_START', { key: ch.key, productName: ch.productName }));
  console.log(`🆔 App ID: ${ch.appId}`);
  console.log(t('BUILD_CHANNEL_ICON', { icon: ch.iconPng }));
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

  // 为每个渠道使用完全隔离的独立临时输出目录，彻底杜绝 NSIS win-unpacked 与 uninstaller 互斥占用冲突
  const channelSubDir = `dist-release/${ch.key.toLowerCase()}`;
  const absChannelSubDir = path.join(ROOT_DIR, channelSubDir);
  const absRootDir = path.join(ROOT_DIR, 'dist-release');

  const channelConfig = {
    ...baseConfig,
    appId: ch.appId,
    productName: ch.productName,
    directories: {
      ...baseConfig.directories,
      output: channelSubDir,
    },
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
      icon: ch.iconPng,
      executableName: ch.productName,
      artifactName: `${ch.productName.replace(/\s+/g, '-')}-Setup-\${version}.\${ext}`,
    },
    mac: {
      ...baseConfig.mac,
      icon: ch.iconPng,
    },
    linux: {
      ...baseConfig.linux,
      icon: ch.iconPng,
    },
  };

  const tempConfigFile = path.join(ROOT_DIR, `electron-builder.${channelKey}.temp.json`);
  fs.writeFileSync(tempConfigFile, JSON.stringify(channelConfig, null, 2), 'utf8');

  try {
    const builderArgs = ['electron-builder', '--config', tempConfigFile, ...extraArgs];
    runStep('npx', builderArgs, t('BUILD_CHANNEL_EXEC_BUILDER', { key: ch.key }));

    // 构建成功后，将子目录产物自动同步到统一根目录 dist-release/，完美兼容 Release 与 CI
    syncArtifactsToRoot(absChannelSubDir, absRootDir);
  } finally {
    try {
      if (fs.existsSync(tempConfigFile)) {
        fs.unlinkSync(tempConfigFile);
      }
    } catch (_) {}
  }

  console.log(t('BUILD_CHANNEL_SUCCESS', { key: ch.key }));
}

function main() {
  const argv = process.argv.slice(2);
  const target = (argv[0] || 'a').toLowerCase();
  const extraArgs = argv.slice(1).filter((arg) => !['a', 'b', 'c', 'all'].includes(arg.toLowerCase()));

  // 1. 清理进程锁与历史编译构建缓存
  cleanupProcessLocks();
  runStep('node', ['scripts/clean-electron.js'], t('BUILD_CHANNEL_CLEAN_CACHE'));
  runStep('npx', ['tsc', '-p', 'tsconfig.json'], t('BUILD_CHANNEL_COMPILE_MAIN_TS'));
  runStep('npx', ['tsc', '-p', 'tsconfig.render.json'], t('BUILD_CHANNEL_COMPILE_RENDER_TS'));
  runStep('node', ['scripts/copy-electron-views.js'], t('BUILD_CHANNEL_COPY_VIEWS'));

  // 2. 确保图标齐全
  ensureIcons();

  // 3. 执行打包
  if (target === 'all') {
    // 批量打包 Windows A, B, C 三个版本，在版本之间保留释放时间缓冲
    console.log(`\n${t('BUILD_CHANNEL_ALL_START')}`);
    buildChannel('a', ['--win', ...extraArgs]);
    cleanupProcessLocks();
    buildChannel('b', ['--win', ...extraArgs]);
    cleanupProcessLocks();
    buildChannel('c', ['--win', ...extraArgs]);
    cleanupProcessLocks();
    console.log(`\n${t('BUILD_CHANNEL_ALL_SUCCESS')}`);
  } else {
    buildChannel(target, extraArgs);
  }
}

main();
