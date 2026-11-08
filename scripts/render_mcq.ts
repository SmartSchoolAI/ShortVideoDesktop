import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface MCQRenderTask {
  questionId: number;
  lang: 'zh' | 'en';
  id: string;
  file: string;
}

const ALL_COMPOSITIONS: MCQRenderTask[] = [
  // 中文版本
  {
    questionId: 1,
    lang: 'zh',
    id: 'MCQ-Q1-ZH-有理分式无穷极限-Aoede通关风',
    file: 'MCQ-Q1-ZH-有理分式无穷极限-Aoede通关风.mp4',
  },
  {
    questionId: 2,
    lang: 'zh',
    id: 'MCQ-Q2-ZH-连续与可导判定-Aoede通关风',
    file: 'MCQ-Q2-ZH-连续与可导判定-Aoede通关风.mp4',
  },
  {
    questionId: 3,
    lang: 'zh',
    id: 'MCQ-Q3-ZH-乘积链式求导-Aoede通关风',
    file: 'MCQ-Q3-ZH-乘积链式求导-Aoede通关风.mp4',
  },
  {
    questionId: 4,
    lang: 'zh',
    id: 'MCQ-Q4-ZH-零处极限化简-Aoede通关风',
    file: 'MCQ-Q4-ZH-零处极限化简-Aoede通关风.mp4',
  },
  {
    questionId: 5,
    lang: 'zh',
    id: 'MCQ-Q5-ZH-三角复合积分-Aoede通关风',
    file: 'MCQ-Q5-ZH-三角复合积分-Aoede通关风.mp4',
  },
  // 英文版本
  {
    questionId: 1,
    lang: 'en',
    id: 'MCQ-Q1-EN-RationalLimitInfinity-Aoede',
    file: 'MCQ-Q1-EN-RationalLimitInfinity-Aoede.mp4',
  },
  {
    questionId: 2,
    lang: 'en',
    id: 'MCQ-Q2-EN-ContinuityDifferentiability-Aoede',
    file: 'MCQ-Q2-EN-ContinuityDifferentiability-Aoede.mp4',
  },
  {
    questionId: 3,
    lang: 'en',
    id: 'MCQ-Q3-EN-ProductChainRule-Aoede',
    file: 'MCQ-Q3-EN-ProductChainRule-Aoede.mp4',
  },
  {
    questionId: 4,
    lang: 'en',
    id: 'MCQ-Q4-EN-LimitAtZero-Aoede',
    file: 'MCQ-Q4-EN-LimitAtZero-Aoede.mp4',
  },
  {
    questionId: 5,
    lang: 'en',
    id: 'MCQ-Q5-EN-TrigCompositeIntegral-Aoede',
    file: 'MCQ-Q5-EN-TrigCompositeIntegral-Aoede.mp4',
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
    { id: 'ApCalculusMCQ-Demo-ZH', file: 'ApCalculusMCQ-Demo-ZH.mp4' },
    { id: 'ApCalculusMCQ-Demo-EN', file: 'ApCalculusMCQ-Demo-EN.mp4' },
  ];
} else if (isDemoZh) {
  targetTasks = [{ id: 'ApCalculusMCQ-Demo-ZH', file: 'ApCalculusMCQ-Demo-ZH.mp4' }];
} else if (isDemoEn) {
  targetTasks = [{ id: 'ApCalculusMCQ-Demo-EN', file: 'ApCalculusMCQ-Demo-EN.mp4' }];
} else {
  let filtered = ALL_COMPOSITIONS;

  // 语言过滤
  if (langArg === 'zh' || langArg === 'chinese') {
    filtered = filtered.filter((t) => t.lang === 'zh');
  } else if (langArg === 'en' || langArg === 'english') {
    filtered = filtered.filter((t) => t.lang === 'en');
  }

  // 题目 ID 过滤 (如 --id=1 或 --id=1,3)
  if (idArg) {
    const ids = idArg.split(',').map((x) => parseInt(x.trim(), 10)).filter(Boolean);
    if (ids.length > 0) {
      filtered = filtered.filter((t) => ids.includes(t.questionId));
    }
  }

  targetTasks = filtered.map((t) => ({ id: t.id, file: t.file }));
}

const outDir = path.resolve('out/mcq');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log(`\n🚀 开始批量渲染 AP 微积分短视频...`);
console.log(`📋 共匹配到 ${targetTasks.length} 个视频渲染任务:`);
targetTasks.forEach((t, i) => console.log(`   ${i + 1}. [${t.id}] -> out/mcq/${t.file}`));
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
  const localBundleDir = path.resolve('BundledCodeCache/ApCalculusMCQ');
  const desktopBundleDir = path.resolve('build/remotion-bundle/ApCalculusMCQ');
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
