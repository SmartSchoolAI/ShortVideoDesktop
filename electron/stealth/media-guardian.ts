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
 * 2. 动态主播放器判定（Primary Player Detection）：实时根据几何渲染面积与祖先容器识别出唯一的主要预览播放器；
 * 3. 辅助组件（封面、缩略图、裁剪器、不可见小尺寸节点）强制静音；
 * 4. 同源防重机制：若同一视频源存在多个实例，仅面积最大的主实例有发声权，其余同源实例强制静音；
 * 5. 音频独占播放守护：当主播放器发声时，暂停并静音同页其余媒体；
 * 6. 原生 makeNative 深度封装，彻底规避反爬检测。
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

    // 检查元素是否明确处于封面/缩略图/裁剪器等辅助容器中
    function isInAuxiliaryContainer(media) {
      if (!media || !(media instanceof HTMLElement)) return false;
      try {
        const auxAncestor = media.closest(
          '.cover-wrap, .cover-preview, .poster-wrap, .thumb-wrap, .crop-container, ' +
          '[class*="cover"], [class*="thumb"], [class*="crop"], [class*="poster"], ' +
          '[class*="cut"], [class*="frame-picker"], [data-type*="cover"], [data-type*="thumb"]'
        );
        return Boolean(auxAncestor);
      } catch (e) {
        return false;
      }
    }

    // 2. 动态主播放器判定算法（Primary Player Detection）
    // 返回当前页面上唯一的合法主视频播放器（面积最大且不在辅助容器内的可见视频）
    function findPrimaryVideo(videoList) {
      if (!videoList || videoList.length === 0) return null;
      if (videoList.length === 1) {
        // 唯有一个视频时，只要不在封面容器中即为主视频
        return isInAuxiliaryContainer(videoList[0]) ? null : videoList[0];
      }

      // 候选视频：排除明确处于封面容器中的视频
      const candidates = videoList.filter(v => !isInAuxiliaryContainer(v));
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      // 多个候选视频时，计算其渲染几何尺寸面积
      let maxArea = -1;
      let primary = candidates[0];

      for (const v of candidates) {
        try {
          const rect = v.getBoundingClientRect();
          const area = rect.width * rect.height;
          // 若处于隐藏状态（display: none, visibility: hidden, opacity: 0）则面积视为 0
          const style = window.getComputedStyle(v);
          const isHidden = style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.1;
          const effectiveArea = isHidden ? 0 : area;

          if (effectiveArea > maxArea) {
            maxArea = effectiveArea;
            primary = v;
          }
        } catch (e) {}
      }

      return primary;
    }

    // 3. 原生静音操作函数（安全修改，不造成不可逆的原型污染）
    function muteMediaElement(media) {
      if (!media || !(media instanceof HTMLMediaElement)) return;
      try {
        if (!media.muted) media.muted = true;
        if (media.volume > 0) media.volume = 0;
      } catch (e) {}
    }

    // 4. 音频独占与同源防重音守护核心决策
    function applyAudioExclusivity(triggerMedia) {
      try {
        const allMedia = getAllMediaElements();
        const videoList = allMedia.filter(m => m.tagName === 'VIDEO');
        const primaryVideo = findPrimaryVideo(videoList);

        for (const m of allMedia) {
          // 如果该元素被明确判定为主视频播放器，则不强制静音（保留创作者正常的试听与音量控制权）
          if (m === primaryVideo) {
            continue;
          }

          // 其余所有视频（封面截帧、缩略图、同源副视频、不可见小尺寸节点）一律强制静音
          muteMediaElement(m);
        }

        // 若当前有某个主媒体正处于有声播放状态，确保其余非当前媒体暂停并静音
        if (triggerMedia && !triggerMedia.muted && triggerMedia.volume > 0) {
          for (const m of allMedia) {
            if (m === triggerMedia) continue;
            try {
              if (!m.paused) {
                m.pause();
              }
              muteMediaElement(m);
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
          const allMedia = getAllMediaElements();
          const videoList = allMedia.filter(m => m.tagName === 'VIDEO');
          const primaryVideo = findPrimaryVideo(videoList);

          if (this !== primaryVideo) {
            // 非主播放器尝试调用 play()，强制静音以完成后台抽帧/seek，绝不出声
            muteMediaElement(this);
          } else {
            // 主播放器尝试调用 play()，立即对同页其余媒体实施独占
            applyAudioExclusivity(this);
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
        const allMedia = getAllMediaElements();
        const videoList = allMedia.filter(m => m.tagName === 'VIDEO');
        const primaryVideo = findPrimaryVideo(videoList);

        if (target !== primaryVideo) {
          muteMediaElement(target);
        } else {
          applyAudioExclusivity(target);
        }
      } catch (e) {}
    }

    window.addEventListener('play', handlePlayEvent, true);
    window.addEventListener('playing', handlePlayEvent, true);

    // 7. MutationObserver 监听动态插入的媒体元素
    const observer = new MutationObserver((mutations) => {
      try {
        let hasMedia = false;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                hasMedia = true;
              } else if (node.querySelectorAll && node.querySelectorAll('video, audio').length > 0) {
                hasMedia = true;
              }
            }
          }
        }
        if (hasMedia) {
          applyAudioExclusivity();
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

    // 8. 周期性守护心跳（每 1 秒校验一次，动态跟踪与修正多媒体状态）
    setInterval(() => {
      try {
        applyAudioExclusivity();

        const mediaList = getAllMediaElements();
        let audiblePlayingList = [];

        for (const m of mediaList) {
          if (!m.paused && !m.muted && m.volume > 0) {
            audiblePlayingList.push(m);
          }
        }

        // 若发现存在 2 个或以上正在同时发声的播放器，仅保留主要播放器，将其余强制暂停并静音
        if (audiblePlayingList.length > 1) {
          const videoList = mediaList.filter(m => m.tagName === 'VIDEO');
          const primary = findPrimaryVideo(videoList);

          for (const extra of audiblePlayingList) {
            if (extra !== primary) {
              try {
                extra.pause();
                muteMediaElement(extra);
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    }, 1000);

    // 初始执行一次全局守护
    try {
      applyAudioExclusivity();
    } catch (e) {}

  } catch (err) {}
})();
`;
}

export const MEDIA_GUARDIAN_SCRIPT = generateMediaGuardianScript();
