/**
 * Anti-detection / Stealth 脚本
 * 工业级浏览器指纹伪装，彻底抹除 Chromium/Electron 自动化与机器人特征
 * 严格对标真实 Windows 原生 Google Chrome 128
 *
 * 核心设计原则：
 * 1. 优先尊重底层 Chromium 原生环境，绝不过度篡改已由 Blink 参数（如 AutomationControlled 关闭）保障的原生特性；
 * 2. 严禁使用普通 Object 替换原生 NavigatorUAData 类实例，防止原型链与 instanceof 校验断裂；
 * 3. 严禁向 window.chrome 注入已成风控黑名单特征的旧版 puppeteer-stealth 签名（如 chrome.runtime.PlatformOs）；
 * 4. 彻底消除 DOM/Console 痕迹，绝不向网页 DOM 注入任何非页面原生节点。
 * 
 * 警告：此文件内容为注入浏览器前端直接解析的纯 JavaScript 源码字符串，
 * 严禁包含任何 TypeScript 类型语法（如 as any, : number 等），否则会导致浏览器解析报 SyntaxError 中断！
 */
export function generateStealthScript(targetPlatform: string = process.platform, targetArch: string = process.arch): string {
  const isMac = targetPlatform === 'darwin';
  const isLinux = targetPlatform === 'linux';
  const isArm = targetArch === 'arm64' || targetArch === 'arm';

  const uaSyntheticPlatform = isMac ? 'macOS' : isLinux ? 'Linux' : 'Windows';
  const uaSyntheticPlatformVersion = isMac ? '14.0.0' : isLinux ? '6.5.0' : '15.0.0';
  const navPlatform = isMac ? 'MacIntel' : isLinux ? (isArm ? 'Linux aarch64' : 'Linux x86_64') : 'Win32';
  const archValue = isArm ? 'arm' : 'x86';
  const webglVendor = isMac ? 'Google Inc. (Apple)' : isLinux ? 'Google Inc. (Mesa)' : 'Google Inc. (NVIDIA)';
  const webglRenderer = isMac
    ? 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1 Metal - 88.1)'
    : isLinux
      ? 'ANGLE (Mesa, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)'
      : 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';

  return `
(function() {
  'use strict';
  try {
    // -------------------------------------------------------------
    // 全局防重入检测：采用私有 Symbol 挂载，彻底隐藏痕迹，防止被 getOwnPropertyNames 遍历特征
    // -------------------------------------------------------------
    const stealthSymbol = Symbol.for('__core_st_v1__');
    if (typeof window !== 'undefined' && window[stealthSymbol]) {
      return;
    }
    try {
      if (typeof window !== 'undefined') {
        Object.defineProperty(window, stealthSymbol, {
          value: 1,
          writable: false,
          enumerable: false,
          configurable: false
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 0. 原生函数 toString 深度保护器
    // -------------------------------------------------------------
    const nativeToString = Function.prototype.toString;
    const mockedFunctions = new WeakSet();

    function makeNative(fn, name) {
      if (!fn) return fn;
      if (name) {
        try {
          Object.defineProperty(fn, 'name', { value: name, configurable: true });
        } catch (e) {}
      }
      mockedFunctions.add(fn);
      return fn;
    }

    try {
      const customToString = function toString() {
        if (this === customToString || mockedFunctions.has(this)) {
          return 'function ' + (this.name || '') + '() { [native code] }';
        }
        return nativeToString.call(this);
      };
      mockedFunctions.add(customToString);
      Function.prototype.toString = customToString;
    } catch (e) {}

    // -------------------------------------------------------------
    // 1. 擦除所有 Node.js / Electron / CDP / 自动化工具特征残留
    // -------------------------------------------------------------
    try {
      const botGlobals = [
        // Electron / Node 残留
        'process', 'Buffer', 'require', 'module', 'exports', 'global', '__dirname', '__filename', '__electron', '_electron',
        // CDP / ChromeDriver 残留
        'cdc_adoQpoasnfa76pfcZLmcfl_Array', 'cdc_adoQpoasnfa76pfcZLmcfl_Promise', 'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
        // Selenium / WebDriver 残留
        '__webdriver_evaluate', '__selenium_evaluate', '__webdriver_script_function', '__webdriver_script_func', '__webdriver_script_fn',
        '__fxdriver_evaluate', '__driver_evaluate', '__webdriver_unwrapped', '__driver_unwrapped', '__selenium_unwrapped',
        '__fxdriver_unwrapped', '_Selenium_IDE_Recorder', '_WEBDRIVER_ELEM_CACHE', 'domAutomation', 'domAutomationController',
        // Playwright / Puppeteer / Nightmare / PhantomJS 残留
        '__playwright', '__pw_manualStatus', '__puppeteer_evaluation_script__', '__nightmare', '_phantom', 'callPhantom'
      ];

      for (let i = 0; i < botGlobals.length; i++) {
        const prop = botGlobals[i];
        try {
          if (typeof window !== 'undefined' && prop in window) {
            delete (window)[prop];
          }
        } catch (e) {}
        try {
          if (typeof document !== 'undefined' && prop in document) {
            delete (document)[prop];
          }
        } catch (e) {}
      }

      // 深度清理 document 上可能存在的 $cdc_ 注入
      try {
        if (typeof document !== 'undefined') {
          delete (document)['$cdc_asdjflasutopfhvcZLmcfl_'];
        }
      } catch (e) {}
    } catch (e) {}

    // -------------------------------------------------------------
    // 2. 精准修复 navigator.webdriver (严格维持标准 Chromium 原生规范)
    // -------------------------------------------------------------
    try {
      if (Object.prototype.hasOwnProperty.call(navigator, 'webdriver')) {
        delete (navigator)['webdriver'];
      }
      if (navigator.webdriver !== false) {
        Object.defineProperty(Navigator.prototype, 'webdriver', {
          get: makeNative(function() {
            if (!(this instanceof Navigator)) {
              throw new TypeError("Failed to read the 'webdriver' property from 'Navigator': Illegal invocation");
            }
            return false;
          }, 'get webdriver'),
          configurable: true,
          enumerable: true,
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 2.5 插件列表真实化 (navigator.plugins & navigator.mimeTypes)
    // 搭载标准 Symbol.iterator 与 Symbol.toStringTag，彻底杜绝插件迭代与原型检测破绽
    // -------------------------------------------------------------
    try {
      if (!navigator.plugins || navigator.plugins.length === 0) {
        const rawPluginsData = [
          {
            name: 'PDF Viewer',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
            mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
          },
          {
            name: 'Chrome PDF Viewer',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
            mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
          },
          {
            name: 'Chromium PDF Viewer',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
            mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
          },
          {
            name: 'Microsoft Edge PDF Viewer',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
            mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
          },
          {
            name: 'WebKit built-in PDF',
            filename: 'internal-pdf-viewer',
            description: 'Portable Document Format',
            mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }]
          }
        ];

        const pluginArray = Object.create(PluginArray.prototype);
        const mimeTypeArray = Object.create(MimeTypeArray.prototype);

        rawPluginsData.forEach(function(p, pIndex) {
          const plugin = Object.create(Plugin.prototype);
          Object.defineProperties(plugin, {
            name: { value: p.name, enumerable: true },
            filename: { value: p.filename, enumerable: true },
            description: { value: p.description, enumerable: true },
            length: { value: p.mimeTypes.length, enumerable: true },
          });

          p.mimeTypes.forEach(function(m, mIndex) {
            const mimeType = Object.create(MimeType.prototype);
            Object.defineProperties(mimeType, {
              type: { value: m.type, enumerable: true },
              suffixes: { value: m.suffixes, enumerable: true },
              description: { value: m.description, enumerable: true },
              enabledPlugin: { value: plugin, enumerable: true },
            });

            plugin[mIndex] = mimeType;
            plugin[m.type] = mimeType;

            mimeTypeArray[mimeTypeArray.length || 0] = mimeType;
            mimeTypeArray[m.type] = mimeType;
          });

          pluginArray[pIndex] = plugin;
          pluginArray[p.name] = plugin;
        });

        // 补齐真实标准浏览器的 Symbol.iterator 迭代器支持 (支持 for...of, [...plugins], Array.from)
        try {
          pluginArray[Symbol.iterator] = Array.prototype[Symbol.iterator];
          mimeTypeArray[Symbol.iterator] = Array.prototype[Symbol.iterator];
        } catch (e) {}

        Object.defineProperties(pluginArray, {
          length: { value: rawPluginsData.length, enumerable: false },
          item: { value: makeNative(function(index) { return this[index] || null; }, 'item') },
          namedItem: { value: makeNative(function(name) { return this[name] || null; }, 'namedItem') },
          refresh: { value: makeNative(function() {}, 'refresh') },
          [Symbol.toStringTag]: { value: 'PluginArray', configurable: true }
        });

        Object.defineProperties(mimeTypeArray, {
          length: { value: 2, enumerable: false },
          item: { value: makeNative(function(index) { return this[index] || null; }, 'item') },
          namedItem: { value: makeNative(function(name) { return this[name] || null; }, 'namedItem') },
          [Symbol.toStringTag]: { value: 'MimeTypeArray', configurable: true }
        });

        Object.defineProperty(Navigator.prototype, 'plugins', {
          get: makeNative(function() { return pluginArray; }, 'get plugins'),
          enumerable: true,
          configurable: true,
        });

        Object.defineProperty(Navigator.prototype, 'mimeTypes', {
          get: makeNative(function() { return mimeTypeArray; }, 'get mimeTypes'),
          enumerable: true,
          configurable: true,
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 3. 维护原生 navigator.userAgentData 原型链完整性
    // -------------------------------------------------------------
    try {
      if (navigator.userAgentData) {
        // 如果底层已有原生 NavigatorUAData 实例，绝不替换整个对象，仅清洗 brands 里的 Electron 字样
        const originalBrands = navigator.userAgentData.brands;
        if (Array.isArray(originalBrands)) {
          const hasElectron = originalBrands.some(function(b) {
            return (b.brand || '').toLowerCase().indexOf('electron') !== -1;
          });
          if (hasElectron) {
            const cleanBrands = [
              { brand: 'Google Chrome', version: '131' },
              { brand: 'Chromium', version: '131' },
              { brand: 'Not_A Brand', version: '24' }
            ];
            Object.defineProperty(navigator.userAgentData, 'brands', {
              get: makeNative(function() { return cleanBrands; }, 'get brands'),
              configurable: true,
              enumerable: true
            });
          }
        }
      } else {
        // 若环境完全缺失 userAgentData，构造符合标准 NavigatorUAData 形状的数据
        const defaultBrands = [
          { brand: 'Google Chrome', version: '131' },
          { brand: 'Chromium', version: '131' },
          { brand: 'Not_A Brand', version: '24' }
        ];
        const uaData = {
          brands: defaultBrands,
          mobile: false,
          platform: '${uaSyntheticPlatform}',
          getHighEntropyValues: makeNative(function() {
            return Promise.resolve({
              architecture: '${archValue}',
              bitness: '64',
              brands: defaultBrands,
              mobile: false,
              model: '',
              platform: '${uaSyntheticPlatform}',
              platformVersion: '${uaSyntheticPlatformVersion}',
              uaFullVersion: '131.0.6778.205'
            });
          }, 'getHighEntropyValues'),
          toJSON: makeNative(function() {
            return { brands: defaultBrands, mobile: false, platform: '${uaSyntheticPlatform}' };
          }, 'toJSON')
        };
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          get: makeNative(function() { return uaData; }, 'get userAgentData'),
          configurable: true,
          enumerable: true
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 4. 标准 Google Chrome 运行环境补齐 (绝不引入旧版 stealth 的伪造特征)
    // -------------------------------------------------------------
    try {
      if (!window.chrome) {
        window.chrome = {};
      }
      if (!window.chrome.app) {
        window.chrome.app = {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: makeNative(function getDetails() { return null; }, 'getDetails'),
          getIsInstalled: makeNative(function getIsInstalled() { return false; }, 'getIsInstalled'),
          runningState: makeNative(function runningState() { return 'cannot_run'; }, 'runningState')
        };
      }
      if (!window.chrome.csi) {
        window.chrome.csi = makeNative(function csi() {
          return { startE: Date.now(), onloadT: Date.now(), pageT: 0, tran: 15 };
        }, 'csi');
      }
      if (!window.chrome.loadTimes) {
        window.chrome.loadTimes = makeNative(function loadTimes() {
          return {
            commitLoadTime: Date.now() / 1000,
            connectionInfo: 'http/1.1',
            finishDocumentLoadTime: Date.now() / 1000,
            finishLoadTime: Date.now() / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'unknown',
            requestTime: Date.now() / 1000,
            startLoadTime: Date.now() / 1000,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: false,
            wasNpnNegotiated: false
          };
        }, 'loadTimes');
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 5. 语言与平台规范对齐 (Windows Chrome 128)
    // -------------------------------------------------------------
    try {
      if (!navigator.languages || navigator.languages.length === 0) {
        Object.defineProperty(Navigator.prototype, 'languages', {
          get: makeNative(function() { return ['zh-CN', 'zh', 'en-US', 'en']; }, 'get languages'),
          configurable: true,
          enumerable: true,
        });
      }
      if (!navigator.language) {
        Object.defineProperty(Navigator.prototype, 'language', {
          get: makeNative(function() { return 'zh-CN'; }, 'get language'),
          configurable: true,
          enumerable: true,
        });
      }
      const expectedPlatform = '${navPlatform}';
      if (!navigator.platform || navigator.platform !== expectedPlatform) {
        Object.defineProperty(Navigator.prototype, 'platform', {
          get: makeNative(function() { return expectedPlatform; }, 'get platform'),
          configurable: true,
          enumerable: true,
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 6. WebGL 真实环境保障：仅消除 SwiftShader/llvmpipe 无头特征
    // -------------------------------------------------------------
    try {
      const getParameterHandler = function(originalGetParameter) {
        return makeNative(function getParameter(parameter) {
          const res = originalGetParameter.call(this, parameter);
          if (parameter === 37445 && typeof res === 'string' && (res.indexOf('Google SwiftShader') !== -1 || res.indexOf('llvmpipe') !== -1)) {
            return '${webglVendor}';
          }
          if (parameter === 37446 && typeof res === 'string' && (res.indexOf('SwiftShader') !== -1 || res.indexOf('llvmpipe') !== -1 || res.indexOf('Software') !== -1)) {
            return '${webglRenderer}';
          }
          return res;
        }, 'getParameter');
      };

      if (window.WebGLRenderingContext) {
        const orig = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = getParameterHandler(orig);
      }
      if (window.WebGL2RenderingContext) {
        const orig2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = getParameterHandler(orig2);
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 7. 权限查询 API (navigator.permissions.query)
    // -------------------------------------------------------------
    try {
      const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
      if (originalQuery) {
        window.navigator.permissions.query = makeNative(function(parameters) {
          if (parameters && parameters.name === 'notifications') {
            return Promise.resolve({
              state: Notification.permission || 'default',
              onchange: null,
              addEventListener: makeNative(function() {}, 'addEventListener'),
              removeEventListener: makeNative(function() {}, 'removeEventListener'),
              dispatchEvent: makeNative(function() { return false; }, 'dispatchEvent'),
            });
          }
          return originalQuery.call(this, parameters);
        }, 'query');
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 8. 窗口尺寸真实化 (防止 Headless 无头零尺寸特征)
    // -------------------------------------------------------------
    try {
      if (window.outerWidth === 0 && window.outerHeight === 0) {
        Object.defineProperty(window, 'outerWidth', {
          get: makeNative(function() { return window.innerWidth || 1440; }, 'get outerWidth'),
          configurable: true,
        });
        Object.defineProperty(window, 'outerHeight', {
          get: makeNative(function() { return window.innerHeight || 900; }, 'get outerHeight'),
          configurable: true,
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 9. Web Component Shadow DOM 穿透 (将 closed 安全转化为 open)
    // 赋能自动化精准操控如 <xhs-publish-btn> 等 Web Component 内部按钮
    // -------------------------------------------------------------
    try {
      const origAttachShadow = Element.prototype.attachShadow;
      if (origAttachShadow) {
        Element.prototype.attachShadow = makeNative(function(init) {
          try {
            if (init && init.mode === 'closed') {
              init = Object.assign({}, init, { mode: 'open' });
            }
          } catch (e) {}
          return origAttachShadow.call(this, init);
        }, 'attachShadow');
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 10. 硬件并发数与触控点对齐典型 Windows PC
    // -------------------------------------------------------------
    try {
      if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 4) {
        Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
          get: makeNative(function() { return 8; }, 'get hardwareConcurrency'),
          configurable: true,
          enumerable: true,
        });
      }
      if (navigator.maxTouchPoints === undefined) {
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', {
          get: makeNative(function() { return 0; }, 'get maxTouchPoints'),
          configurable: true,
          enumerable: true,
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 11. 屏幕任务栏差值仿真 (screen.availHeight < screen.height)
    // -------------------------------------------------------------
    try {
      if (window.screen && window.screen.availHeight === window.screen.height) {
        const taskbarH = 40;
        const realAvailH = Math.max(600, window.screen.height - taskbarH);
        Object.defineProperty(Screen.prototype, 'availHeight', {
          get: makeNative(function() { return realAvailH; }, 'get availHeight'),
          configurable: true,
          enumerable: true,
        });
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 12. 防前端页面定时器 debugger 断点反自动化挂起 (setInterval & setTimeout)
    // -------------------------------------------------------------
    try {
      const isDebuggerCode = function(fn) {
        if (!fn) return false;
        try {
          if (typeof fn === 'string') return fn.indexOf('debugger') !== -1;
          if (typeof fn === 'function') {
            const str = nativeToString.call(fn);
            return str.indexOf('debugger') !== -1;
          }
          return false;
        } catch (e) {
          return false;
        }
      };

      const origSetInterval = window.setInterval;
      if (origSetInterval) {
        window.setInterval = makeNative(function(handler, timeout) {
          if (isDebuggerCode(handler)) {
            return -1;
          }
          return origSetInterval.apply(this, arguments);
        }, 'setInterval');
      }

      const origSetTimeout = window.setTimeout;
      if (origSetTimeout) {
        window.setTimeout = makeNative(function(handler, timeout) {
          if (isDebuggerCode(handler)) {
            return -1;
          }
          return origSetTimeout.apply(this, arguments);
        }, 'setTimeout');
      }
    } catch (e) {}

    // -------------------------------------------------------------
    // 13. 页面前后台活跃度伪装 (防止切走 Tab 时前端长连接与 WebSocket 心跳降频/挂起)
    // -------------------------------------------------------------
    try {
      Object.defineProperty(Document.prototype, 'hidden', {
        get: makeNative(function() { return false; }, 'get hidden'),
        configurable: true,
        enumerable: true
      });
      Object.defineProperty(Document.prototype, 'visibilityState', {
        get: makeNative(function() { return 'visible'; }, 'get visibilityState'),
        configurable: true,
        enumerable: true
      });
      Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
        get: makeNative(function() { return 'visible'; }, 'get webkitVisibilityState'),
        configurable: true,
        enumerable: true
      });
      Object.defineProperty(Document.prototype, 'webkitHidden', {
        get: makeNative(function() { return false; }, 'get webkitHidden'),
        configurable: true,
        enumerable: true
      });
    } catch (e) {}
  } catch (e) {
    // 静默处理任何细微异常
  }
})();
`;
}

/**
 * 默认针对当前运行宿主平台生成的指纹隐身脚本（完全向后兼容已有引用）
 */
export const STEALTH_SCRIPT = generateStealthScript();

