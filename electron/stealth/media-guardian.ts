/**
 * Media Guardian / 全景单音频独占与同源防重叠播放守护模块
 * 
 * 核心解决痛点：
 * 在微信视频号助手（channels.weixin.qq.com）或小红书创作者平台等复杂 Web 端中，
 * 编辑已上传/已定时的视频时，页面往往同时挂载了：
 * 1. 左侧大视口主视频预览播放器（供创作者试看与校验内容）；
 * 2. 右侧封面选择器/卡片缩略图提取器/时间轴波形组件（使用内部隐藏或次要 <video> 抽帧）。
 * 辅助抽帧组件在加载相同视频源并在后台 seek/解码时，若未经静音或被意外触发播放，
 * 会与主播放器形成 2-5 秒时间差的双重重叠音频（Echo / Dual Audio Playback）。
 * 
 * 守护机制：
 * 1. 深度穿透全文档（DOM + Shadow DOM + 同源 iframe）实时扫描所有媒体元素；
 * 2. 同源视频防重音独占：若存在多个加载相同视频源的 <video>，仅保留视口面积最大的可见主视频，其余强制永久静音；
 * 3. 辅助组件特征精准识别（封面、缩略图、裁剪器、不可见小尺寸节点）强制静音锁定；
 * 4. 原生原型链 Hook (HTMLMediaElement.prototype.play) 与全局事件捕获，实施全局单一音频独占策略；
 * 5. 属性深度劫持锁定（Object.defineProperty 锁定辅助媒体 muted 为 true，防止脚本意外解静音）；
 * 6. 采用与 anti-detection 相同的 makeNative 原型保护，确保 toString() 为 [native code]，杜绝机器人反爬风险。
 */

export function generateMediaGuardianScript(): string {
  return `
(function() {
  'use strict';
  try {
    const GUARDIAN_KEY = Symbol.for('__sv_media_guardian_v1__');
    if (typeof window === 'undefined' || window[GUARDIAN_KEY]) {
      return;
    }
    try {
      Object.defineProperty(window, GUARDIAN_KEY, {
        value: 1,
        writable: false,
        enumerable: false,
        configurable: false
      });
    } catch (e) {}

    // 0. 原生函数 toString 深度保护器（与反爬模块高度协同）
    const nativeToString = Function.prototype.toString;
    const guardedFunctions = new WeakSet();

    function makeNative(fn, name) {
      if (!fn) return fn;
      if (name) {
        try {
          Object.defineProperty(fn, 'name', { value: name, configurable: true });
        } catch (e) {}
      }
      guardedFunctions.add(fn);
      return fn;
    }

    try {
      const customToString = function toString() {
        if (this === customToString || guardedFunctions.has(this)) {
          return 'function ' + (this.name || '') + '() { [native code] }';
        }
        return nativeToString.call(this);
      };
      guardedFunctions.add(customToString);
      if (!Function.prototype.toString.toString().includes('[native code]')) {
        Function.prototype.toString = customToString;
      }
    } catch (e) {}

    // 1. 穿透 DOM、Shadow DOM 与同源 iframe 获取全量媒体元素
    function getAllMediaElements(root) {
      const results = [];
      const visitedRoots = new Set();

      function traverse(node) {
        if (!node) return;

        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          results.push(node);
        }

        // 穿透 Shadow Root (包含 open/closed 兼容)
        if (node.shadowRoot && !visitedRoots.has(node.shadowRoot)) {
          visitedRoots.add(node.shadowRoot);
          for (let child = node.shadowRoot.firstElementChild; child; child = child.nextElementSibling) {
            traverse(child);
          }
        }

        // 穿透同源 iframe
        if (node.tagName === 'IFRAME') {
          try {
            const doc = node.contentDocument;
            if (doc && !visitedRoots.has(doc)) {
              visitedRoots.add(doc);
              traverse(doc.documentElement);
            }
          } catch (e) {}
        }

        for (let child = node.firstElementChild; child; child = child.nextElementSibling) {
          traverse(child);
        }
      }

      try {
        traverse(root || document.documentElement);
      } catch (e) {}
      return results;
    }

    // 规范化媒体源地址（去除 query/hash 以精准比对是否为同一视频源）
    function getCleanMediaSrc(media) {
      if (!media) return '';
      const raw = media.currentSrc || media.src || media.getAttribute('src') || '';
      if (!raw) return '';
      try {
        const u = new URL(raw, window.location.href);
        return u.origin + u.pathname;
      } catch (e) {
        return raw.split('?')[0].split('#')[0];
      }
    }

    // 2. 识别主播放器 vs 辅助媒体
    // 微信视频号发表页：左侧手机框为大尺寸主播放器（宽一般 > 180, 高一般 > 280）
    // 封面选择、卡片抽帧、动态图生成的 video 尺寸通常较小或不可见，或置于封面容器中
    function isAuxiliaryMedia(media) {
      if (!media || !(media instanceof HTMLMediaElement)) return false;

      try {
        const rect = media.getBoundingClientRect();

        // 不可见、零尺寸或极小缩略图尺寸
        if (rect.width < 140 || rect.height < 140) return true;

        const style = window.getComputedStyle(media);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.1) {
          return true;
        }

        // 检查父级祖先是否包含封面、卡片、缩略图、裁剪等关键词
        const auxAncestor = media.closest(
          '.cover-wrap, .cover-preview, .poster-wrap, .thumb-wrap, .crop-container, ' +
          '[class*="cover"], [class*="thumb"], [class*="crop"], [class*="poster"], ' +
          '[class*="cut"], [class*="frame-picker"], [data-type*="cover"], [data-type*="thumb"]'
        );
        if (auxAncestor) {
          return true;
        }
      } catch (e) {}

      return false;
    }

    // 3. 永久锁定媒体静音（防止微信前端代码通过 JS 重新设置 muted = false）
    const mutedLockedElements = new WeakSet();
    function lockMediaMuted(media) {
      if (!media || !(media instanceof HTMLMediaElement)) return;
      try {
        media.muted = true;
        media.volume = 0;

        if (!mutedLockedElements.has(media)) {
          mutedLockedElements.add(media);
          try {
            Object.defineProperty(media, 'muted', {
              get: function() { return true; },
              set: function() { /* 拒绝解静音 */ },
              configurable: true
            });
            Object.defineProperty(media, 'volume', {
              get: function() { return 0; },
              set: function() { /* 拒绝调大音量 */ },
              configurable: true
            });
          } catch (e) {}
        }
      } catch (e) {}
    }

    // 4. 同源及同屏视频音频独占决策器
    function enforceAudioExclusivity(triggerMedia) {
      try {
        const allMedia = getAllMediaElements();
        const videoList = allMedia.filter(m => m.tagName === 'VIDEO');

        // A. 基础过滤：直接静音所有符合辅助特征的媒体
        for (const m of allMedia) {
          if (isAuxiliaryMedia(m)) {
            lockMediaMuted(m);
          }
        }

        // B. 同源防重杀：若存在加载同一视频源的多个视频，只保留面积最大的那个发声
        if (videoList.length > 1) {
          const srcGroups = new Map();
          for (const v of videoList) {
            const cleanSrc = getCleanMediaSrc(v);
            if (!cleanSrc) continue;
            if (!srcGroups.has(cleanSrc)) {
              srcGroups.set(cleanSrc, []);
            }
            srcGroups.get(cleanSrc).push(v);
          }

          for (const [, group] of srcGroups) {
            if (group.length > 1) {
              // 按可见物理面积从大到小排序
              group.sort((a, b) => {
                const rA = a.getBoundingClientRect();
                const rB = b.getBoundingClientRect();
                return (rB.width * rB.height) - (rA.width * rA.height);
              });

              // 第 0 个保留为主视频，其余所有同源视频一律强制静音锁定
              for (let i = 1; i < group.length; i++) {
                lockMediaMuted(group[i]);
                try {
                  if (!group[i].paused) group[i].pause();
                } catch (e) {}
              }
            }
          }
        }

        // C. 独占发声：若某个主媒体处于有声播放状态，暂停并静音其余媒体
        if (triggerMedia && !triggerMedia.muted && triggerMedia.volume > 0) {
          for (const m of allMedia) {
            if (m === triggerMedia) continue;
            try {
              if (!m.paused) {
                m.pause();
              }
              m.muted = true;
              m.volume = 0;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // 5. 原生 Hook HTMLMediaElement.prototype.play
    const originalPlay = HTMLMediaElement.prototype.play;
    if (typeof originalPlay === 'function') {
      const guardedPlay = function play() {
        try {
          if (isAuxiliaryMedia(this)) {
            // 辅助媒体允许其静音播放以完成截帧/解码，但绝不允许输出任何声音
            lockMediaMuted(this);
          } else {
            // 主媒体有声播放，立即触发音频独占
            enforceAudioExclusivity(this);
          }
        } catch (e) {}
        return originalPlay.apply(this, arguments);
      };

      makeNative(guardedPlay, 'play');
      try {
        HTMLMediaElement.prototype.play = guardedPlay;
      } catch (e) {}
    }

    // 6. 全局捕获阶段监听 play / playing 事件
    function handlePlayEvent(e) {
      const target = e.target;
      if (!target || !(target instanceof HTMLMediaElement)) return;

      try {
        if (isAuxiliaryMedia(target)) {
          lockMediaMuted(target);
        } else {
          enforceAudioExclusivity(target);
        }
      } catch (e) {}
    }

    window.addEventListener('play', handlePlayEvent, true);
    window.addEventListener('playing', handlePlayEvent, true);

    // 7. MutationObserver 监听动态插入的媒体元素，秒级静音辅助组件
    const observer = new MutationObserver((mutations) => {
      try {
        let hasNewMedia = false;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) { // Element
              if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                hasNewMedia = true;
                if (isAuxiliaryMedia(node)) lockMediaMuted(node);
              } else if (node.querySelectorAll) {
                const subMedia = node.querySelectorAll('video, audio');
                if (subMedia.length > 0) {
                  hasNewMedia = true;
                  for (const sm of subMedia) {
                    if (isAuxiliaryMedia(sm)) lockMediaMuted(sm);
                  }
                }
              }
            }
          }
        }
        if (hasNewMedia) {
          enforceAudioExclusivity();
        }
      } catch (e) {}
    });

    try {
      if (document.documentElement) {
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
          }
        });
      }
    } catch (e) {}

    // 8. 周期性守护心跳（每 1 秒校验一次，防止异步挂载或状态变更导致的漏网双音频）
    setInterval(() => {
      try {
        enforceAudioExclusivity();

        const mediaList = getAllMediaElements();
        let audiblePlayingList = [];

        for (const m of mediaList) {
          if (!m.paused && !m.muted && m.volume > 0) {
            audiblePlayingList.push(m);
          }
        }

        // 若发现存在 2 个或以上正在同时发声的播放器，仅保留视口面积最大的主要播放器，将其余强制静音
        if (audiblePlayingList.length > 1) {
          audiblePlayingList.sort((a, b) => {
            const rA = a.getBoundingClientRect();
            const rB = b.getBoundingClientRect();
            return (rB.width * rB.height) - (rA.width * rA.height);
          });

          // 保留第 0 个（最大主要播放器），暂停并静音其余
          for (let i = 1; i < audiblePlayingList.length; i++) {
            const extra = audiblePlayingList[i];
            try {
              extra.pause();
              lockMediaMuted(extra);
            } catch (e) {}
          }
        }
      } catch (e) {}
    }, 1000);

    // 初始扫描当前页面已有媒体
    try {
      enforceAudioExclusivity();
    } catch (e) {}

  } catch (err) {}
})();
`;
}

export const MEDIA_GUARDIAN_SCRIPT = generateMediaGuardianScript();
