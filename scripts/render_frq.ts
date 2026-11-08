import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface FRQRenderTask {
  questionId: number;
  lang: 'zh' | 'en';
  id: string;
  file: string;
}

const ALL_COMPOSITIONS: FRQRenderTask[] = [
  // 中文版本
  {
    questionId: 1,
    lang: 'zh',
    id: 'FRQ-Q1-ZH-区域面积与旋转体-2019真题',
    file: 'FRQ-Q1-ZH-区域面积与旋转体-2019真题.mp4',
  },
  // 英文版本
  {
    questionId: 1,
    lang: 'en',
    id: 'FRQ-Q1-EN-AreaAndVolume-2019FRQ3',
    file: 'FRQ-Q1-EN-AreaAndVolume-2019FRQ3.mp4',
  },
];

// 解析命令行参数
const argv = process.argv.slice(2);
const langArg = argv.find((a) => a.startsWith('--lang='))?.replace('--lang=', '').toLowerCase();
const idArg = argv.find((a) => a.startsWith('--id='))?.replace('--id=', '');
const isDemoZh = argv.includes('--demo=zh') || argv.includes('--demo-zh');
const isDemoEn = argv.includes('--demo=en') || argv.includes('--demo-en');
const isDemoBoth = argv.includes('--demo') && !isDemoZh && !isDemoEn;

let targetTasks: { id: string; file: string }[] = [];

if (isDemoBoth) {
  targetTasks = [
    { id: 'ApCalculusFRQ-Demo-ZH', file: 'ApCalculusFRQ-Demo-ZH.mp4' },
    { id: 'ApCalculusFRQ-Demo-EN', file: 'ApCalculusFRQ-Demo-EN.mp4' },
  ];
} else if (isDemoZh) {
  targetTasks = [{ id: 'ApCalculusFRQ-Demo-ZH', file: 'ApCalculusFRQ-Demo-ZH.mp4' }];
} else if (isDemoEn) {
  targetTasks = [{ id: 'ApCalculusFRQ-Demo-EN', file: 'ApCalculusFRQ-Demo-EN.mp4' }];
} else {
  let filtered = ALL_COMPOSITIONS;

  // 语言过滤
  if (langArg === 'zh' || langArg === 'chinese') {
    filtered = filtered.filter((t) => t.lang === 'zh');
  } else if (langArg === 'en' || langArg === 'english') {
    filtered = filtered.filter((t) => t.lang === 'en');
  }

  // 题目 ID 过滤
  if (idArg) {
    const ids = idArg.split(',').map((x) => parseInt(x.trim(), 10)).filter(Boolean);
    if (ids.length > 0) {
      filtered = filtered.filter((t) => ids.includes(t.questionId));
    }
  }

  targetTasks = filtered.map((t) => ({ id: t.id, file: t.file }));
}

const outDir = path.resolve('out/ApCalculusFRQ');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log(`\n🚀 开始批量渲染 AP 微积分 FRQ 短视频...`);
console.log(`📋 共匹配到 ${targetTasks.length} 个视频渲染任务:`);
targetTasks.forEach((t, i) => console.log(`   ${i + 1}. [${t.id}] -> out/ApCalculusFRQ/${t.file}`));
console.log(`\n============================================================`);

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let successCount = 0;
let failCount = 0;

for (let i = 0; i < targetTasks.length; i++) {
  const item = targetTasks[i];
  const outPath = path.join(outDir, item.file);

  console.log(`\n[${i + 1}/${targetTasks.length}] 正在渲染: ${item.id}`);
  console.log(`输出目标: ${outPath}`);

  // 优先探测已编译就绪的 Bundle 缓存，大幅缩短首帧与避免重复 webpack 编译
  const localBundleDir = path.resolve('BundledCodeCache/ApCalculusFRQ');
  const desktopBundleDir = path.resolve('build/remotion-bundle/ApCalculusFRQ');
  const entryPoint = (fs.existsSync(localBundleDir) && fs.existsSync(path.join(localBundleDir, 'index.html')))
    ? localBundleDir
    : (fs.existsSync(desktopBundleDir) && fs.existsSync(path.join(desktopBundleDir, 'index.html')))
      ? desktopBundleDir
      : 'src/index.ts';

  const args = [
    'remotion',
    'render',
    entryPoint,
    item.id,
    outPath,
    '--gl=angle',
    '--disable-web-security',
    '--concurrency=2',
  ];

  const result = spawnSync(npxCmd, args, {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    console.error(`❌ 渲染失败: ${item.id} (退出码: ${result.status})`);
    failCount++;
  } else {
    console.log(`✅ 渲染成功: ${item.file}`);
    successCount++;
  }
}

console.log(`\n============================================================`);
console.log(`🎉 批量渲染结束！成功: ${successCount}，失败: ${failCount}`);
console.log(`📁 视频输出目录: ${outDir}\n`);

