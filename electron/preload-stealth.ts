import { webFrame } from 'electron';
import { STEALTH_SCRIPT } from './stealth/anti-detection';
import { MEDIA_GUARDIAN_SCRIPT } from './stealth/media-guardian';

/**
 * 平台页面专用隐身预加载脚本 (Preload Stealth)
 * 核心准则：
 * 1. 绝不向第三方网页暴露任何 ipcRenderer、Node 或自定义对象；
 * 2. 在 Chromium 页面创建的最早微秒，通过 webFrame 向主世界 (world 0) 同步注入指纹清洗脚本；
 * 3. 注入全景单音频互斥与防重叠播放守护脚本，杜绝视频号/小红书等编辑页双音频冲突；
 * 4. 彻底消除 executeJavaScript 异步调度造成的微小时间差漏洞。
 */
try {
  webFrame.executeJavaScriptInIsolatedWorld(0, [
    { code: STEALTH_SCRIPT },
    { code: MEDIA_GUARDIAN_SCRIPT }
  ]);
} catch {
  try {
    // 降级直接执行（附带安全 DOM 容器校验）
    const scriptEl = document.createElement('script');
    scriptEl.textContent = `${STEALTH_SCRIPT}\n${MEDIA_GUARDIAN_SCRIPT}`;
    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(scriptEl);
      scriptEl.remove();
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        try {
          (document.head || document.documentElement)?.appendChild(scriptEl);
          scriptEl.remove();
        } catch {}
      });
    }
  } catch {}
}

