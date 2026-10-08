import { WebContents } from 'electron';
import fs from 'fs';
import { BasePlatform, PublishPayload, PlatformPublishResult, PublishAbortedError } from './base-platform';
import { PlatformTabAdapter } from '../services/window-manager';
import { CdpPageClient } from '../services/cdp-bridge';
import { sleep, simulateClipboardHesitation, waitHumanInterval } from '../utils/human-simulator';
import { ActionTracer } from '../utils/action-tracer';
import { WECHAT_PUBLISH_STEPS, getPlatformPublishSteps } from '../utils/step-bar';
import { tPlatform, getPlatformDisplayName } from './platform-i18n';

/**
 * 通用 Shadow DOM / iframe 深度穿透工具函数（字符串形式，可嵌入任意 evaluate 表达式）
 * 在 evaluate 回调内内联调用：eval(WALK_ALL_FN); const all = walkAll(document);
 * 注意：此字符串仅用于文档内嵌，不可直接执行于 Node.js 作用域
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _WALK_ALL_HINT = `/* walkAll 已在每个 evaluate 内联定义以保证 CDP 序列化可用 */`;

export class WechatChannelsPlatform extends BasePlatform {
  readonly platformId = 'wechat';
  get name(): string {
    return getPlatformDisplayName('wechat');
  }
  readonly homeUrl = 'https://channels.weixin.qq.com/';
  readonly publishUrl = 'https://channels.weixin.qq.com/platform/post/create';

  /**
   * 探测微信视频号页面真实状态（严格防未登录误判）
   */
  async detectPageState(webContents: WebContents): Promise<{
    url: string;
    isPublishPage: boolean;
    isLoggedIn: boolean;
    isExplicitlyLoggedOut: boolean;
  }> {
    if (!webContents || webContents.isDestroyed()) {
      return {
        url: '',
        isPublishPage: false,
        isLoggedIn: false,
        isExplicitlyLoggedOut: true,
      };
    }

    try {
      const state = await webContents.executeJavaScript(`
        (() => {
          const url = window.location.href;
          const bodyText = document.body ? (document.body.innerText || '') : '';

          // 1. 绝对一票否决：检测是否存在登录二维码或未登录提示
          const isLoginQrElement = (el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 50 || r.height < 50) return false;
            const inLoginContainer = Boolean(
              el.closest('.weui-desktop-qr-code, .login-qrcode, .login-box, .login-modal, [class*="login"], .weui-desktop-dialog__wrp')
            );
            const isQrTag = el.matches('.weui-desktop-qr-code, .login-qrcode, [class*="qrcode"], [class*="qr-code"], img[src*="qrcode"]');
            return inLoginContainer || isQrTag;
          };

          const qrElements = Array.from(document.querySelectorAll(
            '.weui-desktop-qr-code, .login-qrcode, .login-box, [class*="qrcode"], [class*="qr-code"], img[src*="qrcode"], canvas'
          ));
          const hasVisibleQr = qrElements.some(isLoginQrElement);

          const hasLoginKeywords = 
            bodyText.includes('微信扫码登录') || 
            bodyText.includes('请使用微信扫描二维码登录') || 
            bodyText.includes('微信扫一扫') ||
            bodyText.includes('扫码登录');

          const hasLoginModal = Boolean(
            document.querySelector('.login-box, .login-modal, .weui-desktop-dialog__wrp') &&
            (bodyText.includes('登录') || hasVisibleQr)
          );

          const isExplicitlyLoggedOut = hasVisibleQr || hasLoginKeywords || hasLoginModal || url.includes('/login');

          // 2. 正向凭证：检测是否存在真正已登录的用户特征
          const hasAccountInfo = Boolean(
            document.querySelector('.finder-nickname, .account-info, .weui-desktop-account__info, .weui-desktop-account__nickname, .account-name') ||
            document.querySelector('img.avatar, .weui-desktop-avatar')
          );
          const hasPlatformNav = (bodyText.includes('动态管理') || bodyText.includes('数据中心') || bodyText.includes('人员设置') || bodyText.includes('视频号助手')) && !isExplicitlyLoggedOut;

          const inputs = Array.from(document.querySelectorAll('input'));
          const hasShortTitle = inputs.some(i => {
            const ph = (i.placeholder || i.getAttribute('placeholder') || '').toLowerCase();
            return ph.includes('短标题') || ph.includes('标题');
          }) || bodyText.includes('短标题');

          const hasUploadArea = (bodyText.includes('上传时长8小时内') || 
                                bodyText.includes('建议分辨率720p') || 
                                bodyText.includes('上传视频') ||
                                Boolean(document.querySelector('input[type="file"]'))) && !isExplicitlyLoggedOut;

          // 必须在绝对无未登录二维码且确实处于发表页面时才判定为有效发表页
          const isPublishPage = !isExplicitlyLoggedOut && (hasShortTitle || (hasUploadArea && url.includes('/post/create')));

          // 真正登录态：绝对不能有未登录特征，且必须具有账号信息、平台导航或有效发表页
          const isLoggedIn = !isExplicitlyLoggedOut && (hasAccountInfo || hasPlatformNav || isPublishPage);

          return {
            url,
            isPublishPage,
            isLoggedIn,
            isExplicitlyLoggedOut,
          };
        })()
      `);
      return state;
    } catch {
      return {
        url: webContents.getURL(),
        isPublishPage: false,
        isLoggedIn: false,
        isExplicitlyLoggedOut: false,
      };
    }
  }

  /**
   * 检查是否已登录视频号（必须严格排除未登录二维码状态）
   */
  async checkLoginStatus(webContents: WebContents): Promise<boolean> {
    const state = await this.detectPageState(webContents);
    return state.isLoggedIn;
  }

  /**
   * 持续监听等待用户扫码完成登录（未登录时坚决停留等待，绝不抢跑）
   */
  async waitForLogin(
    webContents: WebContents,
    tracer: ActionTracer,
    timeoutMs = 300000,
    signal?: AbortSignal
  ): Promise<boolean> {
    const startTime = Date.now();
    const platformName = this.getDisplayName();
    await tracer.track(tPlatform('waitingLogin', undefined, { platform: platformName }), null, 'warn', { persistent: true });

    let lastLogTime = 0;
    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted || webContents.isDestroyed()) return false;
      const state = await this.detectPageState(webContents);
      if (state.isLoggedIn) {
        await tracer.track(tPlatform('loginSuccess', undefined, { platform: platformName }), null, 'success');
        return true;
      }
      if (Date.now() - lastLogTime > 8000) {
        lastLogTime = Date.now();
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        await tracer.track(tPlatform('waitingLoginTick', undefined, { platform: platformName, elapsed: elapsedSec }), null, 'info', { persistent: true });
      }
      await sleep(1500, signal);
    }
    return false;
  }

  /**
   * 自动清理页面遮罩与公约提示（穿透 Shadow DOM 与 iframe）
   */
  async dismissDialogs(client: CdpPageClient, tracer: ActionTracer): Promise<void> {
    const signal = tracer.getSignal();
    if (signal?.aborted || tracer.isAborted() || client.isClosedNow()) return;
    try {
      const targetBtn: any = await client.evaluate(() => {
        const walkAllButtons = (root: any): HTMLElement[] => {
          const res: HTMLElement[] = [];
          if (!root) return res;
          const btns = root.querySelectorAll
            ? Array.from(root.querySelectorAll('button, .weui-desktop-btn, .weui-desktop-dialog__btn, [role="button"], a, div'))
            : [];
          for (const b of btns as HTMLElement[]) {
            const txt = (b.textContent || (b as any).innerText || '').trim();
            if (['我知道了', '确定', '同意并继续', '知道了', '确认', '关闭'].includes(txt)) {
              res.push(b);
            }
          }
          const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
          for (const el of all as HTMLElement[]) {
            if ((el as any).shadowRoot) res.push(...walkAllButtons((el as any).shadowRoot));
            if (el.tagName === 'IFRAME') {
              try {
                const d = (el as HTMLIFrameElement).contentDocument;
                if (d) res.push(...walkAllButtons(d));
              } catch { }
            }
          }
          return res;
        };

        const targetBtns = walkAllButtons(document);
        if (targetBtns.length > 0) {
          const btn: any = targetBtns[0];
          const txt = (btn.textContent || '').trim();
          btn.scrollIntoView({ behavior: 'auto', block: 'center' });
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return { text: txt, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          }
        }
        return null;
      });

      if (targetBtn && targetBtn.x && targetBtn.y) {
        await client.mouseClick(targetBtn.x, targetBtn.y);
        await tracer.track(tPlatform('dismissedDialog', undefined, { btn: targetBtn.text }), null, 'success');
        await sleep(1200, signal);
      }
    } catch { }
  }

  /**
   * 登录成功后，在视频号助手主页或列表页拟人化寻找并点击【发表视频】按钮进入新建页面
   */
  async navigateToNewPostPage(client: CdpPageClient, tracer: ActionTracer, adapter?: PlatformTabAdapter): Promise<boolean> {
    await tracer.track(tPlatform('checkingPublishPage'));

    // 检查是否已经在发表页面
    const curUrl = await client.evaluate(() => location.href).catch(() => '');
    if (curUrl.includes('/post/create')) {
      await tracer.track(`${tPlatform('alreadyOnPublishPage')} (/post/create)`);
      return true;
    }

    await tracer.track(tPlatform('findingPublishEntry', undefined, { btn: '发表视频' }));

    // 寻找页面上的【发表视频】按钮（如右上角显眼的黄色大按钮或左侧菜单）
    for (let attempt = 0; attempt < 5; attempt++) {
      const btnInfo = await client.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button, a, .weui-desktop-btn, div, span')) as HTMLElement[];

        // 优先匹配右上角黄色的【发表视频】主按钮
        const publishBtns = all.filter((el) => {
          if (el.children.length > 2) return false;
          const txt = (el.textContent || '').trim();
          return txt === '发表视频' || txt === '发表动态' || txt === '发布视频';
        });

        for (const btn of publishBtns) {
          const r = btn.getBoundingClientRect();
          if (r.width > 30 && r.height > 20 && r.top >= 0 && r.left >= 0) {
            btn.scrollIntoView({ behavior: 'auto', block: 'center' });
            return {
              found: true,
              text: (btn.textContent || '').trim(),
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
            };
          }
        }

        // 备用：查找链接 href 包含 /post/create 的节点
        const links = all.filter((el) => {
          const href = (el.getAttribute('href') || '').toLowerCase();
          return href.includes('/post/create');
        });
        if (links.length > 0) {
          const r = links[0].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return {
              found: true,
              text: '发表链接',
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
            };
          }
        }

        return { found: false };
      }).catch(() => ({ found: false }));

      if (btnInfo && btnInfo.found && btnInfo.x && btnInfo.y) {
        await tracer.track(tPlatform('clickedPublishEntry', undefined, { btn: btnInfo.text }));
        await client.mouseClick(btnInfo.x, btnInfo.y);
        await sleep(2500);

        const afterUrl = await client.evaluate(() => location.href).catch(() => '');
        if (afterUrl.includes('/post/create')) {
          await tracer.track(tPlatform('enteredPublishPageSuccess'), null, 'success');
          return true;
        }
      }

      await sleep(1000);
    }

    // 若通过点击未能触发，备用通过 loadURL 强行导航
    if (adapter) {
      await tracer.track(tPlatform('fallbackDirectNav'));
      await adapter.loadURL(this.publishUrl);
      await sleep(2500);
      return true;
    }

    return false;
  }

  /**
   * 严格等待发表页面渲染就绪（确保脱离白屏，关键组件如上传区域/表单已挂载）
   */
  async waitForPublishPageReady(
    client: CdpPageClient,
    tracer: ActionTracer,
    timeoutMs = 35000,
    signal?: AbortSignal
  ): Promise<boolean> {
    const startTime = Date.now();
    const platformName = this.getDisplayName();
    await tracer.track(tPlatform('waitingPageReady', undefined, { platform: platformName }), null, 'info', { persistent: true });

    let consecutiveReadyCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted || tracer.isAborted() || client.isClosedNow()) {
        throw new PublishAbortedError(tPlatform('tabClosed', undefined, { platform: platformName }));
      }

      const pageInfo = await client.evaluate(() => {
        const body = document.body;
        if (!body) return { isReady: false, bodyLen: 0, reason: 'body不存在' };
        const readyState = document.readyState;
        const text = body.innerText || '';
        const bodyLen = text.length;

        // 核心一票否决：当前 URL 必须真正包含 /post/create，绝不能在视频列表页或主页误判就绪！
        const curUrl = window.location.href;
        if (!curUrl.includes('/post/create')) {
          return { isReady: false, readyState, reason: '当前未处于发表页URL: ' + curUrl };
        }

        // 检查是否存在真正可见且阻塞的 loading 动画 (排除隐藏节点)
        const loadingEls = Array.from(document.querySelectorAll('.weui-desktop-loading, .loading-mask, .spin-loading')) as HTMLElement[];
        const hasLoadingMask = loadingEls.some((el) => {
          if (!el || el.offsetParent === null) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        });

        // 特征 1：上传视频大区域 (不仅是 input，需同时具备真实提示文案或拖拽框)
        const hasUploadText = text.includes('上传时长8小时内') ||
          text.includes('建议分辨率720p') ||
          text.includes('上传视频') ||
          text.includes('拖拽视频');
        const hasFileInput = Boolean(document.querySelector('input[type="file"]') || document.querySelector('input[accept*="video"]'));
        const hasUploadArea = hasUploadText || hasFileInput;

        // 特征 2：表单输入框或发表按钮
        const buttons = Array.from(document.querySelectorAll('button, .weui-desktop-btn'));
        const hasPublishBtn = buttons.some((b) => ((b as any).innerText || b.textContent || '').includes('发表'));
        const inputs = Array.from(document.querySelectorAll('input'));
        const hasVisibleInputs = inputs.some((i) => i.offsetParent !== null);
        const hasEditor = Boolean(document.querySelector('[contenteditable="true"]') || document.querySelector('textarea'));

        // 严格判定：进入发表页、无可见阻塞 Loading、且命中发布核心组件 (上传区 / 描述输入框)
        const isReady = (readyState === 'complete' || readyState === 'interactive') &&
          !hasLoadingMask &&
          (hasUploadArea || (hasVisibleInputs && hasEditor) || hasPublishBtn);

        return {
          isReady,
          readyState,
          hasLoadingMask,
          hasUploadArea,
          hasPublishBtn,
          hasVisibleInputs,
          bodyLen,
          inputsCount: inputs.length,
        };
      }).catch((err: any) => {
        if (signal?.aborted || tracer.isAborted() || client.isClosedNow()) {
          throw new PublishAbortedError(tPlatform('tabClosed', undefined, { platform: platformName }));
        }
        return null;
      });

      if (pageInfo && pageInfo.isReady) {
        consecutiveReadyCount++;
        // 两次连续确认通过（间隔 600ms），确保页面渲染真正沉淀稳定
        if (consecutiveReadyCount >= 2) {
          await tracer.track(tPlatform('pageReadySuccess', undefined, { platform: platformName }), pageInfo, 'success');
          // 拟人化自然浏览：注入微小平滑滚动，激活页面交互事件
          await client.evaluate(() => {
            try {
              window.scrollBy({ top: 30, behavior: 'smooth' });
              setTimeout(() => window.scrollBy({ top: -30, behavior: 'smooth' }), 500);
            } catch { }
          }).catch(() => { });
          return true;
        }
        await sleep(600, signal);
        continue;
      } else {
        consecutiveReadyCount = 0;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed > 0 && elapsed % 2 === 0) {
        await tracer.track(
          tPlatform('waitingPageReadyTick', undefined, { platform: platformName, elapsed }),
          null,
          'info',
          { persistent: true }
        );
      }

      await sleep(800, signal);
    }

    await tracer.track(tPlatform('pageReadyTimeout'), null, 'warn');
    return false;
  }

  /**
   * 原生注入本地视频素材 (穿透 Shadow DOM 与 iframe，支持文件弹窗无感拦截)
   */
  async uploadVideoViaCdp(client: CdpPageClient, filePath: string, tracer: ActionTracer): Promise<boolean> {
    await tracer.track(tPlatform('preparingCdpUpload'), { path: filePath });

    // 1. 开启 Page 级文件选择器拦截，彻底杜绝操作系统弹窗
    try {
      await client.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
    } catch { }

    let interceptedBackendNodeId: number | null = null;
    const fileChooserHandler = (params: any) => {
      if (params?.backendNodeId) {
        interceptedBackendNodeId = params.backendNodeId;
      }
    };
    client.on('Page.fileChooserOpened', fileChooserHandler);

    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        // 先行检查：确保当前处于发表页面
        const curUrl = await client.evaluate(() => location.href).catch(() => '');
        if (!curUrl.includes('/post/create')) {
          await tracer.track(tPlatform('uploadRetry'), null, 'warn');
          await this.navigateToNewPostPage(client, tracer);
          await sleep(2000);
        }

        // A. 尝试直接穿透递归 Shadow DOM 寻找 input[type="file"] 注入
        try {
          const ok = await client.setInputFiles('input[type="file"]', filePath);
          if (ok) {
            await tracer.track(tPlatform('uploadSuccess', undefined, { attempt: attempt + 1 }), null, 'success');
            return true;
          }
        } catch (err: any) {
          await tracer.track(tPlatform('uploadAttemptFailed', undefined, { attempt: attempt + 1, error: err.message }), null, 'warn');
        }

        // B. 若尚未挂载 input，穿透 Shadow DOM 寻觅最内层真正的叶子上传按钮/区域进行物理点击唤醒
        const btnCoord: any = await client.evaluate(() => {
          const walkFindUploadButton = (root: any): HTMLElement | null => {
            if (!root) return null;
            const all = root.querySelectorAll ? Array.from(root.querySelectorAll('button, div, span, a, p, label')) : [];
            for (const el of all as HTMLElement[]) {
              // 优先查找具备明确上传类名或文本的容器
              const cls = (el.className || '').toString();
              const txt = (el.textContent || '').trim();
              if (
                cls.includes('post-upload') ||
                cls.includes('upload-area') ||
                cls.includes('upload-container') ||
                cls.includes('weui-desktop-upload')
              ) {
                return el;
              }

              // 必须是叶子或接近叶子的节点，防止误选顶级布局节点
              if (el.children.length <= 3) {
                if (
                  txt === '上传视频' ||
                  txt === '点击上传' ||
                  txt.includes('拖拽视频') ||
                  txt.includes('上传时长8小时') ||
                  txt.includes('建议分辨率') ||
                  txt.includes('选择视频')
                ) {
                  return el;
                }
              }
              if (el.shadowRoot) {
                const r = walkFindUploadButton(el.shadowRoot);
                if (r) return r;
              }
              if (el.tagName === 'IFRAME') {
                try {
                  const d = (el as HTMLIFrameElement).contentDocument;
                  const r = d && walkFindUploadButton(d);
                  if (r) return r;
                } catch { }
              }
            }
            return null;
          };

          const uploadBtn: any = walkFindUploadButton(document);
          if (uploadBtn) {
            uploadBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
            const r = uploadBtn.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
          }
          return null;
        }).catch(() => null);

        if (btnCoord && btnCoord.x && btnCoord.y) {
          await client.mouseClick(btnCoord.x, btnCoord.y);
        }

        await sleep(1000);

        // C. 检查是否触发了无感拦截的文件选择对话框
        if (interceptedBackendNodeId) {
          try {
            await client.sendCommand('DOM.setFileInputFiles', {
              files: [filePath],
              backendNodeId: interceptedBackendNodeId,
            });
            await tracer.track(tPlatform('interceptedFileChooser'), null, 'success');
            return true;
          } catch (e: any) {
            await tracer.track(`backendNodeId upload failed: ${e.message}`, null, 'warn');
          }
        }
      }

      // 如果 5 轮均未成功，立即输出详细环境诊断数据
      const diag = await client.diagnoseDomEnvironment();
      await tracer.track('🔍 DOM Environment Diagnosis', diag, 'warn');

      return false;
    } finally {
      client.off('Page.fileChooserOpened', fileChooserHandler);
      try {
        await client.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false });
      } catch { }
    }
  }

  /**
   * 严格等待微信解析短视频并呈现右侧编辑表单（短标题、描述话题等组件挂载）
   */
  async waitForEditFormReady(
    client: CdpPageClient,
    tracer: ActionTracer,
    timeoutMs = 30000,
    signal?: AbortSignal
  ): Promise<boolean> {
    const effectiveSignal = signal || tracer.getSignal();
    const startTime = Date.now();
    const platformName = this.getDisplayName();
    await tracer.track(tPlatform('waitingFormReady', undefined, { platform: platformName }), null, 'info', { persistent: true });

    while (Date.now() - startTime < timeoutMs) {
      if (effectiveSignal?.aborted || tracer.isAborted() || client.isClosedNow()) {
        throw new PublishAbortedError(tPlatform('tabClosed', undefined, { platform: platformName }));
      }
      const formInfo = await client.evaluate(() => {
        const walkFindElements = (root: any) => {
          let inputs: HTMLInputElement[] = [];
          let editors: HTMLElement[] = [];
          if (!root) return { inputs, editors };

          try {
            const curInputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
            inputs.push(...curInputs.filter(i => i.type !== 'file' && i.type !== 'hidden'));
            const curEditors = Array.from(
              root.querySelectorAll('[contenteditable], [role="textbox"], .input-editor, textarea')
            ) as HTMLElement[];
            editors.push(...curEditors);
          } catch { }

          const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
          for (const el of all as HTMLElement[]) {
            if (el.shadowRoot) {
              const res = walkFindElements(el.shadowRoot);
              inputs.push(...res.inputs);
              editors.push(...res.editors);
            }
            if (el.tagName === 'IFRAME') {
              try {
                const d = (el as HTMLIFrameElement).contentDocument;
                if (d) {
                  const res = walkFindElements(d);
                  inputs.push(...res.inputs);
                  editors.push(...res.editors);
                }
              } catch { }
            }
          }
          return { inputs, editors };
        };

        const { inputs, editors } = walkFindElements(document);
        const bodyText = document.body ? document.body.innerText : '';
        const hasShortTitle = inputs.some((i) => {
          const ph = (i.placeholder || i.getAttribute('placeholder') || '').toLowerCase();
          return ph.includes('短标题') || ph.includes('标题');
        }) || bodyText.includes('短标题');

        const hasDescEditor = editors.length > 0 || bodyText.includes('动态描述') || bodyText.includes('添加描述') || bodyText.includes('话题');
        const isReady = (inputs.length > 0 && editors.length > 0) || (hasShortTitle && hasDescEditor);

        return {
          isReady,
          inputsCount: inputs.length,
          editorsCount: editors.length,
          hasShortTitle,
          hasDescEditor,
        };
      }).catch((err: any) => {
        if (effectiveSignal?.aborted || tracer.isAborted() || client.isClosedNow()) {
          throw new PublishAbortedError(tPlatform('tabClosed', undefined, { platform: platformName }));
        }
        return null;
      });

      if (formInfo && formInfo.isReady) {
        await tracer.track(tPlatform('formReadySuccess', undefined, { platform: platformName }), formInfo, 'success');
        return true;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed > 0 && elapsed % 3 === 0) {
        await tracer.track(
          tPlatform('waitingFormReadyTick', undefined, { platform: platformName, elapsed }),
          null,
          'info',
          { persistent: true }
        );
      }

      await sleep(1000, effectiveSignal);
    }

    await tracer.track(tPlatform('formReadyTimeout', undefined, { platform: platformName }), null, 'error');
    return false;
  }

  /**
   * 取消/删除当前上传的视频（用于上传失败、断流或重置后清理并重新上传）
   */
  async deleteCurrentVideo(client: CdpPageClient, tracer: ActionTracer): Promise<boolean> {
    await tracer.track(tPlatform('deletingCurrentVideo'));

    const clickDelResult = await client.evaluate(() => {
      const walkAll = (root: any): Element[] => {
        const res: Element[] = [];
        if (!root) return res;
        const list = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const el of list as Element[]) {
          res.push(el);
          if ((el as any).shadowRoot) res.push(...walkAll((el as any).shadowRoot));
          if (el.tagName === 'IFRAME') {
            try {
              const d = (el as HTMLIFrameElement).contentDocument;
              if (d) res.push(...walkAll(d));
            } catch { }
          }
        }
        return res;
      };

      const all = walkAll(document);

      // 策略 A：优先寻找“重新上传”按钮
      const reuploadBtn: any = all.find((el) => {
        const txt = (el.textContent || '').trim();
        const isButton = el.tagName === 'BUTTON' || el.tagName === 'A' || (el.className && typeof el.className === 'string' && el.className.includes('btn'));
        return isButton && (txt === '重新上传' || txt.includes('重新上传'));
      });

      if (reuploadBtn) {
        reuploadBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
        const r = reuploadBtn.getBoundingClientRect();
        return { found: true, type: 'reupload', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }

      // 策略 B：寻找视频卡片下方的“删除”按钮
      const delBtn: any = all.find((el) => {
        const txt = (el.textContent || '').trim();
        const isButton = el.tagName === 'BUTTON' || el.tagName === 'A' || (el.className && typeof el.className === 'string' && el.className.includes('btn'));
        return isButton && (txt === '删除' || txt === '删除视频');
      });

      if (delBtn) {
        delBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
        const r = delBtn.getBoundingClientRect();
        return { found: true, type: 'delete', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }

      return { found: false, type: 'none' };
    });

    if (!clickDelResult.found) {
      await tracer.track('No delete/re-upload button found', null, 'warn');
      return false;
    }

    if (clickDelResult.x && clickDelResult.y) {
      await client.mouseClick(clickDelResult.x, clickDelResult.y);
    }

    if (clickDelResult.type === 'reupload') {
      await tracer.track(tPlatform('reuploadTriggered'));
      await sleep(1000);
      return true;
    }

    await sleep(800);

    // 检查并点击二次确认对话框中的“确定”或“删除”
    const confirmCoord = await client.evaluate(() => {
      const walkAll = (root: any): Element[] => {
        const res: Element[] = [];
        if (!root) return res;
        const list = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const el of list as Element[]) {
          res.push(el);
          if ((el as any).shadowRoot) res.push(...walkAll((el as any).shadowRoot));
          if (el.tagName === 'IFRAME') {
            try {
              const d = (el as HTMLIFrameElement).contentDocument;
              if (d) res.push(...walkAll(d));
            } catch { }
          }
        }
        return res;
      };

      const all = walkAll(document);
      const dialog = all.find((el) => {
        const txt = (el.textContent || '').trim();
        return (txt.includes('确定') || txt.includes('确认')) && (txt.includes('删除') || txt.includes('视频'));
      });

      const root = dialog || document;
      const btns = Array.from(root.querySelectorAll('button, .weui-desktop-btn, a, [role="button"]')) as HTMLElement[];
      const confirmBtn: any = btns.find((b) => {
        const txt = (b.textContent || '').trim();
        return ['确定', '确认', '删除', '继续删除'].includes(txt);
      });

      if (confirmBtn) {
        confirmBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
        const r = confirmBtn.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
      return null;
    });

    if (confirmCoord && confirmCoord.x && confirmCoord.y) {
      await client.mouseClick(confirmCoord.x, confirmCoord.y);
    }

    await sleep(2000);
    await tracer.track(tPlatform('deletedVideoSuccess'), null, 'success');
    return true;
  }

  /**
   * 自动配置微信视频号的高级发布项：
   * 1. 位置：设置为“不显示位置”
   * 2. 添加到合集：如果有内容使用第一个合集，如果没有就不显示
   * 3. 声明原创：勾选 -> 原创权益弹窗勾选同意 -> 确认声明
   * 4. 视频标注：标注为 AI 生成的视频
   * 5. 定时发表：小时数值加 1，分钟数随机增加 10~30 分钟
   */
  async configureAdvancedOptions(client: CdpPageClient, tracer: ActionTracer, payload?: PublishPayload): Promise<void> {
    await tracer.track(tPlatform('configuringAdvanced'));

    // ── 穿透 DOM 助手：穿透 shadowRoot 与 iframe，获取全量真实渲染节点 ──
    const getWalkAllScript = () => `
      const walkAll = (root = document) => {
        const res = [];
        if (!root) return res;
        const list = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const el of list) {
          res.push(el);
          if (el.shadowRoot) res.push(...walkAll(el.shadowRoot));
          if (el.tagName === 'IFRAME') {
            try {
              const d = el.contentDocument;
              if (d) res.push(...walkAll(d));
            } catch {}
          }
        }
        return res;
      };
    `;

    // ── 关键保障：主动向页面及 iframe 内部滚动并探测高级选项挂载 ──
    await tracer.track('⏳ 正在滚动探测并等待高级选项组件完全挂载 (合集/原创/AI标注)...');
    let advancedOptionsReady = false;
    for (let waitSec = 0; waitSec < 10; waitSec++) {
      advancedOptionsReady = await client.evaluate(() => {
        const getDocs = () => {
          const docs = [document];
          for (const f of Array.from(document.querySelectorAll('iframe'))) {
            try { if (f.contentDocument) docs.push(f.contentDocument); } catch { }
          }
          return docs;
        };

        for (const doc of getDocs()) {
          try { doc.defaultView?.scrollTo({ top: doc.body?.scrollHeight || 10000, behavior: 'auto' }); } catch { }
          if (doc.querySelector('.post-position-wrap') || doc.querySelector('.post-album-wrap') || doc.querySelector('.declare-original-checkbox') || doc.querySelector('.post-with-mark-tag') || doc.querySelector('.mark-tag-select')) {
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (advancedOptionsReady) {
        await tracer.track(`✅ 高级发布选项组件已检测到并挂载就绪 (耗时 ${waitSec + 1} 秒)！`, null, 'success');
        break;
      }
      await sleep(600);
    }

    // ── 内部物理点击助手：直接调用 Client 的物理输入事件 ──
    const cdpClick = async (x: number, y: number): Promise<void> => {
      await client.mouseClick(x, y);
    };

    // 1. 位置：严格设置为"不显示位置" (穿透多根 iframe)
    try {
      await tracer.track('正在检查并配置【位置】(设置为"不显示位置")...');

      for (let locTry = 0; locTry < 3; locTry++) {
        // 第一阶段：多根穿透定位 .post-position-wrap 并判断是否已选中“不显示位置”
        const locInfo = await client.evaluate(() => {
          const getRoots = () => {
            const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentDocument) {
                  const r = f.getBoundingClientRect();
                  roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                }
              } catch { }
            }
            return roots;
          };

          const roots = getRoots();
          for (const { doc, offsetX, offsetY } of roots) {
            const isNoLocation = (txt: string) => {
              if (!txt) return false;
              const s = txt.trim().toLowerCase();
              return s === '不显示位置' || s === '不显示' || s.includes('不显示') || s.includes('no location') || s.includes('not display') || s.includes('hide location') || s.includes("don't show");
            };

            const wrap = (doc.querySelector('.post-position-wrap') ||
              Array.from(doc.querySelectorAll('*')).find(el => {
                const t = (el.textContent || '').trim().toLowerCase();
                return (t === '位置' || t === 'location') && el.children.length === 0;
              })?.closest('.form-item')?.querySelector('.post-position-wrap')) as HTMLElement | null;
            if (!wrap) continue;

            const locText = (wrap.querySelector('.location-name, .place, .not-display')?.textContent || '').trim();
            // 核心判断：如果存在 .not-display 或文本为“不显示位置”
            if (wrap.querySelector('.not-display') || isNoLocation(locText)) {
              return { found: true, alreadyNone: true };
            }

            // 检查下拉框当前是否已展开
            const filterWrap = wrap.querySelector('.location-filter-wrap') as HTMLElement | null;
            const isExpanded = Boolean(filterWrap && filterWrap.style.display !== 'none' && window.getComputedStyle(filterWrap).display !== 'none');

            // 定位点击展开区域 .position-display
            const trigger = (wrap.querySelector('.position-display, .position-display-wrap') || wrap) as HTMLElement;
            trigger.scrollIntoView({ behavior: 'auto', block: 'center' });
            const r = trigger.getBoundingClientRect();

            return {
              found: true,
              alreadyNone: false,
              isExpanded,
              currentLocation: locText || '当前位置',
              x: Math.round(r.left + offsetX + r.width / 2),
              y: Math.round(r.top + offsetY + r.height / 2)
            };
          }

          return { found: false, reason: '未在任何文档或iframe中找到 .post-position-wrap 容器' };
        });

        if (locInfo.alreadyNone) {
          await tracer.track('✅ [位置] 当前已处于"不显示位置"，无需更改', null, 'success');
          break;
        }

        if (locInfo.found && locInfo.x && locInfo.y) {
          // 始终模拟点击一次 trigger 确保下拉浮层被真实唤出
          await tracer.track(`[位置] 当前位置为: 【${locInfo.currentLocation}】，正在点击展开位置选项菜单 (坐标: ${locInfo.x}, ${locInfo.y})...`);
          await cdpClick(locInfo.x, locInfo.y);
          await sleep(600);

          // 第二阶段：多根穿透全文档定位【不显示位置】选项
          let noneOptInfo: any = null;
          for (let wait = 0; wait < 8; wait++) {
            noneOptInfo = await client.evaluate(() => {
              const isNoLocation = (txt: string) => {
                if (!txt) return false;
                const s = txt.trim().toLowerCase();
                return s === '不显示位置' || s === '不显示' || s.includes('不显示') || s.includes('no location') || s.includes('not display') || s.includes('hide location') || s.includes("don't show");
              };

              const getRoots = () => {
                const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
                for (const f of Array.from(document.querySelectorAll('iframe'))) {
                  try {
                    if (f.contentDocument) {
                      const r = f.getBoundingClientRect();
                      roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                    }
                  } catch { }
                }
                return roots;
              };

              const roots = getRoots();
              for (const { doc, offsetX, offsetY } of roots) {
                // 1. 全局搜索包含“不显示位置”的可见元素
                const allElements = Array.from(doc.querySelectorAll('.location-filter-wrap *, .common-option-list-wrap *, .weui-desktop-dropdown *, .option-item, div, li, span')) as HTMLElement[];
                const matched = allElements.filter(el => {
                  if (el.offsetParent === null) return false;
                  const txt = (el.textContent || '').trim();
                  return isNoLocation(txt) && txt.length <= 25;
                });

                if (matched.length > 0) {
                  // 取最深叶子节点
                  const leaf = matched.filter(el => el.children.length === 0)[0] || matched[0];
                  leaf.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                  const r = leaf.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return {
                      x: Math.round(r.left + offsetX + r.width / 2),
                      y: Math.round(r.top + offsetY + r.height / 2)
                    };
                  }
                }

                // 2. 兜底策略：如果文本未直接匹配，找展开菜单的第一项
                const firstOption = doc.querySelector('.location-filter-wrap .option-item:first-child, .common-option-list-wrap .option-item:first-child') as HTMLElement | null;
                if (firstOption && firstOption.offsetParent !== null) {
                  const r = firstOption.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    return {
                      x: Math.round(r.left + offsetX + r.width / 2),
                      y: Math.round(r.top + offsetY + r.height / 2)
                    };
                  }
                }
              }
              return null;
            });

            if (noneOptInfo && noneOptInfo.x && noneOptInfo.y) break;
            await sleep(400);
          }

          if (noneOptInfo && noneOptInfo.x && noneOptInfo.y) {
            await tracer.track(`[位置] 正在物理点击【不显示位置】选项 (坐标: ${noneOptInfo.x}, ${noneOptInfo.y})...`);
            await cdpClick(noneOptInfo.x, noneOptInfo.y);
            await sleep(800);

            // 验证是否已成功切换
            const isNowNone = await client.evaluate(() => {
              const isNoLocation = (txt: string) => {
                if (!txt) return true;
                const s = txt.trim().toLowerCase();
                return s === '不显示位置' || s === '不显示' || s.includes('不显示') || s.includes('no location') || s.includes('not display') || s.includes('hide location') || s.includes("don't show");
              };
              for (const f of [document, ...(Array.from(document.querySelectorAll('iframe')).map(i => i.contentDocument).filter(Boolean))]) {
                const wrap = (f as Document).querySelector('.post-position-wrap');
                if (!wrap) continue;
                const txt = (wrap.querySelector('.location-name, .place, .not-display')?.textContent || wrap.textContent || '').trim();
                if (wrap.querySelector('.not-display') || isNoLocation(txt) || txt === '') return true;
              }
              return false;
            });

            if (isNowNone) {
              await tracer.track('🎉 [位置] ✅ 已成功设置为"不显示位置"！', null, 'success');
              break;
            } else {
              await tracer.track('[位置] ℹ️ 已触发选取【不显示位置】', null, 'success');
              break;
            }
          } else {
            await tracer.track('[位置] ℹ️ 未能直接检索到下拉选项，按默认设置继续', null, 'info');
            break;
          }
        } else {
          await tracer.track(`[位置] ℹ️ ${locInfo.reason || '略过位置配置'}`);
          break;
        }
      }
    } catch (e: any) {
      await tracer.track(`[位置] 配置略过: ${e.message}`, null, 'warn');
    }

    // 2. 添加到合集：点击下拉框展开，等待API数据拉取渲染完成后，选取第 1 个合集 (穿透多根 iframe)
    try {
      await tracer.track('正在检查并处理【添加到合集】...');

      for (let collTry = 0; collTry < 3; collTry++) {
        // 第一步：多根穿透定位【添加到合集】组件与当前选择状态
        const collInfo = await client.evaluate(() => {
          const getRoots = () => {
            const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentDocument) {
                  const r = f.getBoundingClientRect();
                  roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                }
              } catch { }
            }
            return roots;
          };

          const roots = getRoots();
          for (const { doc, offsetX, offsetY } of roots) {
            const isCollectionHeader = (t: string) => {
              const s = t.trim().toLowerCase();
              return s === '添加到合集' || s === '合集' || s.includes('添加到合集') || s.includes('add to collection') || s.includes('collection') || s.includes('series');
            };

            const wrap = (doc.querySelector('.post-album-wrap') ||
              Array.from(doc.querySelectorAll('*')).find(el => isCollectionHeader(el.textContent || '') && el.children.length === 0)?.closest('.form-item')?.querySelector('.post-album-wrap')) as HTMLElement | null;
            if (!wrap) continue;

            // 检查是否已经选定合集（对齐真实DOM: .collection-text）
            const collectionEl = wrap.querySelector('.collection-text span, .collection-text') as HTMLElement | null;
            const collectionName = (collectionEl ? collectionEl.textContent || '' : '').trim();
            if (collectionName) {
              return { found: true, alreadySelected: true, collName: collectionName };
            }

            const isDefaultPlaceholder = (t: string) => {
              const s = t.trim().toLowerCase();
              return !s || s === '选择合集' || s === '请选择' || s.includes('select collection') || s.includes('choose collection') || s.includes('please select');
            };

            const displayEl = wrap.querySelector('.display-text, .post-album-name') as HTMLElement | null;
            const displayTxt = (displayEl ? displayEl.textContent || '' : '').trim();
            if (displayTxt && !isDefaultPlaceholder(displayTxt)) {
              return { found: true, alreadySelected: true, collName: displayTxt };
            }

            // 检查下拉框当前是否已经处于展开状态
            const filterWrap = wrap.querySelector('.filter-wrap') as HTMLElement | null;
            const isExpanded = Boolean(filterWrap && filterWrap.style.display !== 'none' && window.getComputedStyle(filterWrap).display !== 'none');

            // 定位点击展开区域 .post-album-display
            const trigger = (wrap.querySelector('.post-album-display, .post-album-display-wrap, .display-text') || wrap) as HTMLElement;
            trigger.scrollIntoView({ behavior: 'auto', block: 'center' });
            const r = trigger.getBoundingClientRect();

            return {
              found: true,
              alreadySelected: false,
              isExpanded,
              triggerX: Math.round(r.left + offsetX + r.width / 2),
              triggerY: Math.round(r.top + offsetY + r.height / 2)
            };
          }

          return { found: false, reason: '未在任何文档或iframe中找到 .post-album-wrap 容器' };
        });

        if (collInfo.alreadySelected) {
          await tracer.track(`[添加到合集] 当前已选定合集: 【${collInfo.collName}】`, null, 'success');
          break;
        }

        if (collInfo.found && collInfo.triggerX && collInfo.triggerY) {
          await tracer.track(`[添加到合集] 点击展开合集下拉框 (坐标: ${collInfo.triggerX}, ${collInfo.triggerY})...`);
          await cdpClick(collInfo.triggerX, collInfo.triggerY);
          // 点击后给与充足时间让 Vue 展开菜单并触发 API 请求
          await sleep(1000);

          // 第二步：多根穿透等待 API 数据返回并定位第一项（平稳等待最长 20 秒，杜绝重复触发关闭）
          await tracer.track('⏳ [添加到合集] 正在等待接口加载并返回合集列表数据...');
          let firstOptionInfo: any = null;

          for (let waitStep = 0; waitStep < 40; waitStep++) {
            firstOptionInfo = await client.evaluate(() => {
              const getRoots = () => {
                const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
                for (const f of Array.from(document.querySelectorAll('iframe'))) {
                  try {
                    if (f.contentDocument) {
                      const r = f.getBoundingClientRect();
                      roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                    }
                  } catch { }
                }
                return roots;
              };

              const roots = getRoots();
              for (const { doc, offsetX, offsetY } of roots) {
                const wrap = doc.querySelector('.post-album-wrap');
                const rootToSearch = wrap || doc;

                // 寻找所有可用合集选项（.option-item 内部包含 .name）
                const itemNodes = Array.from(rootToSearch.querySelectorAll('.common-option-list-wrap .option-item, .option-list-wrap .option-item, .filter-wrap .option-item')) as HTMLElement[];
                const validItems: { el: HTMLElement; name: string }[] = [];

                for (const item of itemNodes) {
                  const nameEl = item.querySelector('.name, .item') || item;
                  const name = (nameEl.textContent || '').trim();
                  const lowerName = name.toLowerCase();
                  // 过滤空文本与“创建新合集”
                  if (!name || lowerName.includes('创建新合集') || lowerName.includes('创建合集') || lowerName.includes('create collection') || lowerName.includes('new collection')) continue;
                  validItems.push({ el: item, name });
                }

                if (validItems.length > 0) {
                  // 找到了有效的合集选项！选取第 1 项
                  const firstItem = validItems[0];
                  const targetEl = (firstItem.el.querySelector('.name, .item') || firstItem.el) as HTMLElement;
                  targetEl.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                  const r = targetEl.getBoundingClientRect();

                  if (r.width > 0 && r.height > 0) {
                    return {
                      ready: true,
                      name: firstItem.name,
                      total: validItems.length,
                      x: Math.round(r.left + offsetX + r.width / 2),
                      y: Math.round(r.top + offsetY + r.height / 2)
                    };
                  }
                }
              }

              return { ready: false };
            });

            if (firstOptionInfo && firstOptionInfo.ready && firstOptionInfo.x && firstOptionInfo.y) {
              break;
            }

            if ((waitStep + 1) % 6 === 0) {
              await tracer.track(`[添加到合集] 正在等待接口返回合集数据 (${Math.round((waitStep + 1) * 0.5)}s/20s)...`);
            }

            await sleep(500);
          }

          // 第三步：物理点击选取第 1 个选项
          if (firstOptionInfo && firstOptionInfo.ready && firstOptionInfo.x && firstOptionInfo.y) {
            await tracer.track(`[添加到合集] 接口数据已就绪 (共 ${firstOptionInfo.total} 个合集)，正在选取第 1 项: 【${firstOptionInfo.name}】(坐标: ${firstOptionInfo.x}, ${firstOptionInfo.y})...`);
            await cdpClick(firstOptionInfo.x, firstOptionInfo.y);
            await sleep(800);

            // 验证是否已成功选中（对齐真实DOM: .collection-text）
            const checkSelected = await client.evaluate(() => {
              for (const f of [document, ...(Array.from(document.querySelectorAll('iframe')).map(i => i.contentDocument).filter(Boolean))]) {
                const wrap = (f as Document).querySelector('.post-album-wrap');
                if (!wrap) continue;

                const collEl = wrap.querySelector('.collection-text span, .collection-text');
                const collTxt = (collEl ? collEl.textContent || '' : '').trim();
                if (collTxt) return { selected: true, name: collTxt };

                const displayEl = wrap.querySelector('.display-text');
                const txt = (displayEl ? displayEl.textContent || '' : '').trim();
                if (txt && txt !== '选择合集' && txt !== '请选择') return { selected: true, name: txt };
              }
              return { selected: false, name: '' };
            });

            if (checkSelected.selected) {
              await tracer.track(`🎉 [添加到合集] ✅ 成功选取并确认合集: 【${checkSelected.name || firstOptionInfo.name}】！`, null, 'success');
              break;
            } else {
              await tracer.track(`[添加到合集] ℹ️ 已触发选取第 1 个合集: 【${firstOptionInfo.name}】`, null, 'success');
              break;
            }
          } else {
            await tracer.track('[添加到合集] ℹ️ 当前账号暂无可用合集数据或加载超时，跳过合集选取');
            break;
          }
        } else {
          await tracer.track(`[添加到合集] ℹ️ ${collInfo.reason || '略过合集配置'}`);
          break;
        }
      }
    } catch (e: any) {
      await tracer.track(`[添加到合集] 处理略过: ${e.message}`, null, 'warn');
    }

    // 3. 定时发表：排在合集之后，声明原创之前
    try {
      const now = Date.now();
      // 基准时间判定：若外部指定了有效计划时间且晚于当前时间，则以该指定时间为基准；否则以当前系统时间为基准
      const baseTimestamp = (payload?.scheduledPublishAt && payload.scheduledPublishAt > now)
        ? payload.scheduledPublishAt
        : now;

      // 微信视频号定时发布规则：小时数值保持加 1，分钟数在合规 5 分钟刻度 (05~55分) 中充分随机分布，杜绝固定 03 分
      // 微信视频号官方后台分钟选项为 5 分钟步进 (00, 05, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
      const candidateMinutes = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
      const randomMinute = candidateMinutes[Math.floor(Math.random() * candidateMinutes.length)];

      const targetTime = new Date(baseTimestamp);
      targetTime.setHours(targetTime.getHours() + 1);
      targetTime.setMinutes(randomMinute);
      targetTime.setSeconds(0);

      const pad = (n: number) => n.toString().padStart(2, '0');
      const targetYear = targetTime.getFullYear();
      const targetMonth = targetTime.getMonth() + 1;
      const targetDay = targetTime.getDate();
      const targetHour = targetTime.getHours();
      const targetMinute = targetTime.getMinutes();
      const timeStr = `${targetYear}-${pad(targetMonth)}-${pad(targetDay)} ${pad(targetHour)}:${pad(targetMinute)}`;

      const timeLogDesc = (payload?.scheduledPublishAt && payload.scheduledPublishAt > now)
        ? `指定时间 [小时+1, 分钟选定为: ${pad(targetMinute)}分] -> ${timeStr}`
        : `当前时间 [小时+1, 分钟选定为: ${pad(targetMinute)}分] -> ${timeStr}`;

      const hasScheduledTime = true; // 始终使用定时发表
      if (hasScheduledTime) {
        await tracer.track(`正在配置【定时发表】（设定时间：${timeLogDesc}）...`);

        // 步骤 1：精准定位并多通道激活【定时】单选按钮 (穿透 iframe)
        // WeUI radio 结构: <label><input type="radio"><i class="weui-desktop-icon-radio"></i><span>定时</span></label>
        // 必须点击 <i> 图标元素，点文字 span 无效；同时 JS click label 作辅助触发
        let isTimedActive = false;
        for (let rTry = 0; rTry < 6; rTry++) {
          // 检查日历 dt 组件是否真实挂载（Vue 响应式下比 radio.checked 更可靠）
          const alreadyActive = await client.evaluate(() => {
            const getRoots = () => {
              const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
              for (const f of Array.from(document.querySelectorAll('iframe'))) {
                try {
                  if (f.contentDocument) {
                    const r = f.getBoundingClientRect();
                    roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                  }
                } catch { }
              }
              return roots;
            };

            for (const { doc } of getRoots()) {
              const pickerDt = doc.querySelector('.post-time-wrap .weui-desktop-picker__date dt') as HTMLElement | null;
              const radio1 = doc.querySelector('.post-time-wrap input[type="radio"][value="1"]') as HTMLInputElement | null;
              if (Boolean(pickerDt && pickerDt.offsetParent !== null) || Boolean(radio1?.checked)) {
                return true;
              }
            }
            return false;
          });

          if (alreadyActive) {
            isTimedActive = true;
            await tracer.track('[定时发表] ✅ 定时单选已激活，日历组件已渲染');
            break;
          }

          // 精确定位 WeUI radio 的 <i> 图标元素坐标（多根穿透）
          const clickResult = await client.evaluate(() => {
            const getRoots = () => {
              const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
              for (const f of Array.from(document.querySelectorAll('iframe'))) {
                try {
                  if (f.contentDocument) {
                    const r = f.getBoundingClientRect();
                    roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                  }
                } catch { }
              }
              return roots;
            };

            const isTimedHeader = (t: string) => {
              const s = t.trim().toLowerCase();
              return s.includes('定时发表') || s.includes('schedule post') || s.includes('scheduled publish');
            };
            const isTimedRadioText = (t: string) => {
              const s = t.trim();
              // 精确匹配"定时"，排除"不定时"
              return s === '定时' || s === 'Scheduled' || s === 'Schedule';
            };

            for (const { doc, offsetX, offsetY } of getRoots()) {
              let targetLabel: HTMLElement | null = null;
              let targetIcon: HTMLElement | null = null;

              // 策略 A：从 .post-time-wrap 找 value="1" 的 radio 对应 label
              const wrap = (doc.querySelector('.post-time-wrap') as HTMLElement | null) ||
                (Array.from(doc.querySelectorAll('.form-item')).find(el => isTimedHeader(el.textContent || '')) as HTMLElement | null);
              if (wrap) {
                const radio1 = wrap.querySelector('input[type="radio"][value="1"]') as HTMLInputElement | null;
                if (radio1) {
                  targetLabel = (radio1.closest('label.weui-desktop-form__check-label') || radio1.parentElement) as HTMLElement | null;
                }
              }

              // 策略 B：全局找文字精确为"定时"的 label（排除"不定时"）
              if (!targetLabel) {
                const allLabels = Array.from(doc.querySelectorAll('label.weui-desktop-form__check-label, .weui-desktop-radio-group label')) as HTMLElement[];
                for (const l of allLabels) {
                  const span = l.querySelector('.weui-desktop-form__check-content, span');
                  const txt = ((span ? span.textContent : l.textContent) || '').trim();
                  if (isTimedRadioText(txt)) {
                    targetLabel = l;
                    break;
                  }
                }
              }

              if (!targetLabel) continue;

              // 关键：找 <i class="weui-desktop-icon-radio"> 图标，这才是真正的点击目标
              targetIcon = targetLabel.querySelector('i.weui-desktop-icon-radio, .weui-desktop-icon-radio') as HTMLElement | null;
              const clickTarget = targetIcon || targetLabel;

              clickTarget.scrollIntoView({ behavior: 'auto', block: 'center' });

              // 在 evaluate 内先对 label 执行 JS click（WeUI 内部监听 label click 触发 radio）
              try { targetLabel.click(); } catch (e) { }

              const r = clickTarget.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return {
                  found: true,
                  hasIcon: Boolean(targetIcon),
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                };
              }
            }

            return { found: false, reason: '未找到定时 label' };
          });

          if (clickResult.found && clickResult.x && clickResult.y) {
            await tracer.track(`[定时发表] 正在物理点击【定时】${clickResult.hasIcon ? 'radio图标' : 'label'} (第${rTry + 1}次, 坐标: ${clickResult.x}, ${clickResult.y})...`);
            // CDP 物理鼠标点击 <i> 图标，确保 Vue 原生鼠标事件响应
            await client.mouseClick(clickResult.x, clickResult.y);
            await sleep(900); // 充足等待 Vue 响应式完成 DOM 重渲染
          } else {
            await tracer.track(`[定时发表] ⚠️ ${(clickResult as any).reason || '未找到定时单选'}，等待后重试 (${rTry + 1}/6)...`, null, 'warn');
            await sleep(700);
          }
        }

        if (!isTimedActive) {
          await tracer.track('[定时发表] ⚠️ 未能确认定时单选激活状态，继续尝试后续步骤...', null, 'warn');
        }

        // 步骤 2：等待日历组件渲染，点击【发表时间】日期输入框展开大日历面板 (穿透 iframe)
        // 注意：dd 默认 display:none，展开后变为非 none
        for (let attempt = 1; attempt <= 5; attempt++) {
          const panelState = await client.evaluate(() => {
            const getRoots = () => {
              const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
              for (const f of Array.from(document.querySelectorAll('iframe'))) {
                try {
                  if (f.contentDocument) {
                    const r = f.getBoundingClientRect();
                    roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                  }
                } catch { }
              }
              return roots;
            };

            for (const { doc, offsetX, offsetY } of getRoots()) {
              const dd = doc.querySelector('.post-time-wrap .weui-desktop-picker__date .weui-desktop-picker__dd') as HTMLElement | null;
              const panel = doc.querySelector('.weui-desktop-picker__panel_day');
              const isOpen = Boolean(panel) && Boolean(dd && dd.style.display !== 'none');

              const input = doc.querySelector('.post-time-wrap input[placeholder*="请选择发表时间"]') as HTMLElement | null;
              const dt = doc.querySelector('.post-time-wrap .weui-desktop-picker__date-time dt, .post-time-wrap .weui-desktop-picker__date dt') as HTMLElement | null;
              const targetEl = input || dt;

              if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                const r = targetEl.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return {
                    isOpen,
                    found: true,
                    x: Math.round(r.left + offsetX + r.width / 2),
                    y: Math.round(r.top + offsetY + r.height / 2),
                  };
                }
              }
              if (isOpen) {
                return { isOpen: true, found: true };
              }
            }
            return { isOpen: false, found: false };
          });

          if (panelState.isOpen) {
            await tracer.track('[定时发表] 日历面板已展开');
            break;
          }

          if (panelState.found && panelState.x && panelState.y) {
            await tracer.track(`[定时发表] 正在物理点击日期输入框打开日历 (第 ${attempt} 次, 坐标: ${panelState.x}, ${panelState.y})...`);
            await client.mouseClick(panelState.x, panelState.y);
            await sleep(700);
          } else {
            await tracer.track(`[定时发表] 日历组件未渲染，等待 Vue 响应 (${attempt}/5)...`);
            await sleep(800);
          }
        }

        // 步骤 3：在日历中校准年月并选择目标日期（若跨月/跨年则自动点击右翻页，再点击对应日期的 a 标签，穿透 iframe）
        // 最多支持向前翻页 12 次
        for (let monthFlip = 0; monthFlip < 12; monthFlip++) {
          const monthCheck = await client.evaluate((data: { targetY: number; targetM: number }) => {
            const getRoots = () => {
              const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
              for (const f of Array.from(document.querySelectorAll('iframe'))) {
                try {
                  if (f.contentDocument) {
                    const r = f.getBoundingClientRect();
                    roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                  }
                } catch { }
              }
              return roots;
            };

            for (const { doc, offsetX, offsetY } of getRoots()) {
              const panel = doc.querySelector('.weui-desktop-picker__panel_day');
              if (!panel) continue;

              const labels = Array.from(panel.querySelectorAll('.weui-desktop-picker__panel__label')).map(el => (el.textContent || '').trim());
              const curYearStr = labels.find(l => l.includes('年')) || '';
              const curMonthStr = labels.find(l => l.includes('月')) || '';
              const curYear = parseInt(curYearStr, 10);
              const curMonth = parseInt(curMonthStr, 10);

              if (!isNaN(curYear) && !isNaN(curMonth)) {
                const diffMonths = (data.targetY - curYear) * 12 + (data.targetM - curMonth);
                if (diffMonths > 0) {
                  const nextBtn = panel.querySelector('.weui-desktop-btn__icon__right') as HTMLElement | null;
                  if (nextBtn && nextBtn.style.display !== 'none') {
                    const r = nextBtn.getBoundingClientRect();
                    return {
                      ready: false,
                      needFlip: true,
                      x: Math.round(r.left + offsetX + r.width / 2),
                      y: Math.round(r.top + offsetY + r.height / 2),
                    };
                  }
                }
              }
              return { ready: true, needFlip: false };
            }
            return { ready: false, needFlip: false };
          }, { targetY: targetYear, targetM: targetMonth });

          if (monthCheck.needFlip && monthCheck.x && monthCheck.y) {
            await client.mouseClick(monthCheck.x, monthCheck.y);
            await sleep(400);
          } else {
            break;
          }
        }

        // 在当前已对齐年月的面板中精确定位日期的 a 标签（仅返回坐标，用物理点击，穿透 iframe）
        const dayCoord = await client.evaluate((data: { dayNum: number }) => {
          const { dayNum } = data;
          const getRoots = () => {
            const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentDocument) {
                  const r = f.getBoundingClientRect();
                  roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                }
              } catch { }
            }
            return roots;
          };

          for (const { doc, offsetX, offsetY } of getRoots()) {
            const panel = doc.querySelector('.weui-desktop-picker__panel_day');
            if (!panel) continue;

            const allDayLinks = Array.from(panel.querySelectorAll('table.weui-desktop-picker__table td a')) as HTMLElement[];
            // 优先找非 faded 且非 disabled 的精确匹配
            const exactLink = allDayLinks.find((a) => {
              const txt = (a.textContent || '').trim();
              return txt === String(dayNum) && !a.classList.contains('weui-desktop-picker__disabled') && !a.classList.contains('weui-desktop-picker__faded');
            });
            // 备用：允许 faded（跨月显示日期），但不 disabled
            const fallbackLink = allDayLinks.find((a) => {
              const txt = (a.textContent || '').trim();
              return txt === String(dayNum) && !a.classList.contains('weui-desktop-picker__disabled');
            });

            const targetLink = exactLink || fallbackLink;
            if (targetLink) {
              targetLink.scrollIntoView({ behavior: 'auto', block: 'nearest' });
              const r = targetLink.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return {
                  found: true,
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                };
              }
            }
          }
          return { found: false, reason: `未找到 ${dayNum} 号对应的有效日期选项` };
        }, { dayNum: targetDay });

        if (dayCoord.found && dayCoord.x && dayCoord.y) {
          await tracer.track(`[定时发表] 正在物理点击日期 ${targetDay} 号 (坐标: ${dayCoord.x}, ${dayCoord.y})...`);
          await client.mouseClick(dayCoord.x, dayCoord.y);
          await sleep(600);
        } else {
          await tracer.track(`[定时发表] ${(dayCoord as any).reason || '未找到目标日期'}`, null, 'warn');
        }

        // 步骤 4：点击打开日历底部的时间选择器（判断 dd display 非 none 为已展开，穿透 iframe）
        for (let attempt = 1; attempt <= 4; attempt++) {
          const timeState = await client.evaluate(() => {
            const getRoots = () => {
              const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
              for (const f of Array.from(document.querySelectorAll('iframe'))) {
                try {
                  if (f.contentDocument) {
                    const r = f.getBoundingClientRect();
                    roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                  }
                } catch { }
              }
              return roots;
            };

            for (const { doc, offsetX, offsetY } of getRoots()) {
              const timeDd = doc.querySelector('.weui-desktop-picker__dd__time') as HTMLElement | null;
              const hourPanel = doc.querySelector('ol.weui-desktop-picker__time__hour');
              // dd 默认 display:none，展开后变为非 none
              const isOpen = Boolean(hourPanel) && Boolean(timeDd && timeDd.style.display !== 'none');

              const timeInput = doc.querySelector('.weui-desktop-picker__panel-fd input[placeholder*="请选择时间"], .weui-desktop-picker__panel-fd input.weui-desktop-form__input') as HTMLElement | null;
              const timeDt = doc.querySelector('.weui-desktop-picker__panel-fd .weui-desktop-picker__time dt, .weui-desktop-picker__panel-fd dt') as HTMLElement | null;
              const targetEl = timeInput || timeDt;

              if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                const r = targetEl.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return {
                    isOpen,
                    found: true,
                    x: Math.round(r.left + offsetX + r.width / 2),
                    y: Math.round(r.top + offsetY + r.height / 2),
                  };
                }
              }
              if (isOpen) {
                return { isOpen: true, found: true };
              }
            }
            return { isOpen: false, found: false };
          });

          if (timeState.isOpen) {
            await tracer.track('[定时发表] 时分选择面板已展开');
            break;
          }

          if (timeState.found && timeState.x && timeState.y) {
            await tracer.track(`[定时发表] 正在物理点击时间输入框打开时分选择 (第 ${attempt} 次, 坐标: ${timeState.x}, ${timeState.y})...`);
            await client.mouseClick(timeState.x, timeState.y);
            await sleep(600);
          } else {
            await sleep(500);
          }
        }

        // 步骤 5：在时间面板中精确选择小时和分钟（仅返回坐标，全部用 CDP 物理点击，穿透 iframe）
        const hourMinuteCoords = await client.evaluate((data: { hourStr: string; minStr: string }) => {
          const { hourStr, minStr } = data;
          const getRoots = () => {
            const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentDocument) {
                  const r = f.getBoundingClientRect();
                  roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                }
              } catch { }
            }
            return roots;
          };

          for (const { doc, offsetX, offsetY } of getRoots()) {
            const hourPanel = doc.querySelector('ol.weui-desktop-picker__time__hour');
            const minPanel = doc.querySelector('ol.weui-desktop-picker__time__minute');
            if (!hourPanel || !minPanel) continue;

            // 查找小时
            const hourLis = Array.from(hourPanel.querySelectorAll('li')) as HTMLElement[];
            let targetHourLi = hourLis.find((li) => (li.textContent || '').trim() === hourStr && !li.classList.contains('weui-desktop-picker__disabled'));
            if (!targetHourLi) {
              const availHourLis = hourLis.filter(li => !li.classList.contains('weui-desktop-picker__disabled'));
              const targetNum = parseInt(hourStr, 10);
              if (!isNaN(targetNum) && availHourLis.length > 0) {
                const geList = availHourLis.filter(li => {
                  const val = parseInt((li.textContent || '').trim(), 10);
                  return !isNaN(val) && val >= targetNum;
                });
                targetHourLi = geList.length > 0 ? geList[0] : availHourLis[availHourLis.length - 1];
              }
            }

            // 查找分钟
            const minLis = Array.from(minPanel.querySelectorAll('li')) as HTMLElement[];
            let targetMinLi = minLis.find((li) => (li.textContent || '').trim() === minStr && !li.classList.contains('weui-desktop-picker__disabled'));
            if (!targetMinLi) {
              const availMinLis = minLis.filter(li => !li.classList.contains('weui-desktop-picker__disabled'));
              const targetNum = parseInt(minStr, 10);
              if (!isNaN(targetNum) && availMinLis.length > 0) {
                const geList = availMinLis.filter(li => {
                  const val = parseInt((li.textContent || '').trim(), 10);
                  return !isNaN(val) && val >= targetNum;
                });
                targetMinLi = geList.length > 0 ? geList[0] : availMinLis[availMinLis.length - 1];
              }
            }

            const res: any = { found: true };
            if (targetHourLi) {
              targetHourLi.scrollIntoView({ behavior: 'auto', block: 'center' });
              const r = targetHourLi.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                res.hour = {
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                  val: (targetHourLi.textContent || '').trim(),
                };
              }
            }
            if (targetMinLi) {
              targetMinLi.scrollIntoView({ behavior: 'auto', block: 'center' });
              const r = targetMinLi.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                res.minute = {
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                  val: (targetMinLi.textContent || '').trim(),
                };
              }
            }
            return res;
          }
          return { found: false, reason: '未找到时分选择面板' };
        }, { hourStr: pad(targetHour), minStr: pad(targetMinute) });

        if (hourMinuteCoords.found) {
          if (hourMinuteCoords.hour && hourMinuteCoords.hour.x && hourMinuteCoords.hour.y) {
            await tracer.track(`[定时发表] 正在物理点击小时 ${hourMinuteCoords.hour.val} (坐标: ${hourMinuteCoords.hour.x}, ${hourMinuteCoords.hour.y})...`);
            await client.mouseClick(hourMinuteCoords.hour.x, hourMinuteCoords.hour.y);
            await sleep(400);
          }
          if (hourMinuteCoords.minute && hourMinuteCoords.minute.x && hourMinuteCoords.minute.y) {
            await tracer.track(`[定时发表] 正在物理点击分钟 ${hourMinuteCoords.minute.val} (坐标: ${hourMinuteCoords.minute.x}, ${hourMinuteCoords.minute.y})...`);
            await client.mouseClick(hourMinuteCoords.minute.x, hourMinuteCoords.minute.y);
            await sleep(400);
          }
        } else {
          await tracer.track(`[定时发表] ${(hourMinuteCoords as any).reason || '时分选择失败'}`, null, 'warn');
        }

        // 步骤 6：关闭下拉浮层并核验结果（点击外部区域或 label 触发失焦关闭，穿透 iframe）
        await client.evaluate(() => {
          const getRoots = () => {
            const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentDocument) roots.push({ doc: f.contentDocument, offsetX: 0, offsetY: 0 });
              } catch { }
            }
            return roots;
          };

          for (const { doc } of getRoots()) {
            const labelEl = doc.querySelector('.post-time-wrap .label') as HTMLElement | null;
            if (labelEl) {
              labelEl.click();
              break;
            }
          }
        });
        await sleep(500);

        // 步骤 7：核验输入框中的最终设定值 (穿透 iframe)
        const finalCheck = await client.evaluate(() => {
          const getRoots = () => {
            const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentDocument) roots.push({ doc: f.contentDocument, offsetX: 0, offsetY: 0 });
              } catch { }
            }
            return roots;
          };

          for (const { doc } of getRoots()) {
            const input = doc.querySelector('.post-time-wrap input[placeholder*="请选择发表时间"], .post-time-wrap input.weui-desktop-form__input') as HTMLInputElement | null;
            const dtText = (doc.querySelector('.post-time-wrap .weui-desktop-picker__dt')?.textContent || '').trim();
            const radio1 = doc.querySelector('input[type="radio"][value="1"]') as HTMLInputElement | null;

            if (input?.value || dtText || radio1?.checked) {
              return {
                inputVal: (input?.value || '').trim(),
                dtText,
                isTimedChecked: Boolean(radio1?.checked),
              };
            }
          }

          return {
            inputVal: '',
            dtText: '',
            isTimedChecked: false,
          };
        });

        if (finalCheck.inputVal) {
          await tracer.track(`✅ [定时发表] 已成功设置为: ${finalCheck.inputVal}`, null, 'success');
        } else if (finalCheck.dtText) {
          await tracer.track(`✅ [定时发表] 已成功设置为: ${finalCheck.dtText}`, null, 'success');
        } else if (finalCheck.isTimedChecked || isTimedActive) {
          await tracer.track(`✅ [定时发表] 已成功切换为定时发表模式 (${timeStr})`, null, 'success');
        } else {
          await tracer.track(`⚠️ [定时发表] 未能确认定时发表设定，请手动核对发表时间`, null, 'warn');
        }
      } else {
        await tracer.track('⚡ [定时发表] 未指定计划发布时间，保持【立即发表】模式', null, 'info');
      }
    } catch (e: any) {
      await tracer.track(`[定时发表] 处理略过: ${e.message}`, null, 'warn');
    }

    // 4. 声明原创：勾选 -> 原创权益弹窗协议核对 -> 勾选《声明须知》和《使用条款》 -> 等待【声明原创】按钮激活并点击 -> 验证生效
    try {
      await tracer.track('正在检查并处理【声明原创】...');
      await sleep(600);

      let origConfirmed = false;
      let origTriggerInfo: any = { found: false };

      // 第一步：在主页面定位【声明原创】复选框（滚动并重试最多 6 次，确保长表单渲染完毕）
      for (let rTry = 0; rTry < 6; rTry++) {
        origTriggerInfo = await client.evaluate(() => {
          // 深度穿透函数
          const walkAll = (root: any = document): any[] => {
            const res: any[] = [];
            const stack: any[] = [root];
            while (stack.length > 0) {
              const curr: any = stack.pop();
              if (!curr) continue;
              const children = curr.querySelectorAll ? Array.from(curr.querySelectorAll('*')) : [];
              for (let i = 0; i < children.length; i++) {
                const child: any = children[i];
                res.push(child);
                if (child.shadowRoot) stack.push(child.shadowRoot);
                if (child.tagName === 'IFRAME') {
                  try {
                    const doc = child.contentDocument;
                    if (doc) stack.push(doc);
                  } catch (e) { }
                }
              }
            }
            return res;
          };

          // 每次重试主动触发页面及所有可滚动容器向下滚动
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
          const allEls = walkAll(document);
          for (const el of allEls) {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 100) {
              const s = window.getComputedStyle(el);
              if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
                el.scrollTop = el.scrollHeight;
              }
            }
          }

          // 策略 1: 直接匹配精确类名 .declare-original-checkbox
          let checkboxWrapper: any = document.querySelector('.declare-original-checkbox');

          // 策略 2: 匹配 .post-with-link
          if (!checkboxWrapper) {
            const postWithLink = document.querySelector('.post-with-link');
            if (postWithLink) {
              checkboxWrapper = postWithLink.querySelector('.declare-original-checkbox, .ant-checkbox-wrapper, input[type="checkbox"]') || postWithLink;
            }
          }

          // 策略 3: 全局全文本穿透精确匹配包含“声明后，作品将展示原创标记”或“声明原创”
          if (!checkboxWrapper) {
            const markTextEl: any = allEls.find((el: any) => {
              const t = (el.textContent || '').trim();
              return (t.includes('声明后，作品将展示原创标记') || t.includes('original mark')) && t.length < 80;
            }) || allEls.find((el: any) => {
              const t = (el.textContent || '').trim();
              return (t === '声明原创' || t.includes('声明原创') || t === 'Declare Original') && t.length < 18;
            });

            if (markTextEl) {
              checkboxWrapper = markTextEl.closest('.declare-original-checkbox, .ant-checkbox-wrapper, .form-item, .weui-desktop-form__control-group, label') || markTextEl.parentElement;
            }
          }

          if (!checkboxWrapper) {
            return { found: false, reason: '未在页面中找到【声明原创】复选框容器 (.declare-original-checkbox)' };
          }

          // 检查当前是否已勾选（支持 ant-design 类名与原生 checkbox）
          const input: any = checkboxWrapper.querySelector('input[type="checkbox"]');
          const isChecked = Boolean(
            checkboxWrapper.classList.contains('ant-checkbox-wrapper-checked') ||
            checkboxWrapper.classList.contains('ant-checkbox-checked') ||
            checkboxWrapper.classList.contains('is-checked') ||
            checkboxWrapper.querySelector('.ant-checkbox-wrapper-checked, .ant-checkbox-checked, .is-checked, [aria-checked="true"]') ||
            (input && input.checked)
          );

          if (isChecked) {
            return { found: true, alreadyChecked: true };
          }

          // 定位可被点击的元素（优先 ant-checkbox-inner 或 label，避免点击隐藏的 0 尺寸 input）
          const clickable: any = checkboxWrapper.querySelector('.ant-checkbox-inner, .ant-checkbox, .ant-checkbox-wrapper, label, input[type="checkbox"]') || checkboxWrapper;

          clickable.scrollIntoView({ behavior: 'auto', block: 'center' });
          const r = clickable.getBoundingClientRect();

          return {
            found: true,
            alreadyChecked: false,
            x: Math.round(r.left + r.width / 2),
            y: Math.round(r.top + r.height / 2)
          };
        });

        if (origTriggerInfo.found) break;
        await sleep(1000);
      }

      if (origTriggerInfo.alreadyChecked) {
        await tracer.track('✅ [声明原创] 当前已处于原创勾选状态', null, 'success');
        origConfirmed = true;
      } else if (origTriggerInfo.found && origTriggerInfo.x && origTriggerInfo.y) {
        // 通过 CDP 物理派发硬件鼠标事件点击主表单【声明原创】复选框触发弹窗
        await cdpClick(origTriggerInfo.x, origTriggerInfo.y);
        await tracer.track('已点击【声明原创】复选框，正在等待【原创权益】弹窗呈现...');

        let dialogDetected = false;
        let detectReason = '';
        for (let i = 0; i < 20; i++) {
          await sleep(350);

          const detectRes = await client.evaluate(() => {
            const getRoots = () => {
              const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
              const iframes = Array.from(document.querySelectorAll('iframe'));
              for (const f of iframes) {
                try {
                  if (f.contentDocument) {
                    const r = f.getBoundingClientRect();
                    roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                  }
                } catch { }
              }
              return roots;
            };

            const roots = getRoots();
            for (const { doc } of roots) {
              // 维度 1: 容器匹配
              if (doc.querySelector('.declare-original-dialog') || doc.querySelector('.original-proto-wrapper')) {
                return { detected: true, reason: '匹配到 .declare-original-dialog / .original-proto-wrapper' };
              }

              // 维度 2: 文本匹配
              const all = Array.from(doc.querySelectorAll('*'));
              const titleEl = all.find(el => {
                const t = (el.textContent || '').trim();
                return t === '原创权益' || (t.includes('原创权益') && t.length < 20);
              });
              if (titleEl) {
                return { detected: true, reason: '检测到【原创权益】标题' };
              }

              // 维度 3: 弹窗确认按钮就绪
              const confirmBtn = all.find(el => (el.tagName === 'BUTTON' || (el as HTMLElement).classList?.contains('weui-desktop-btn')) && (el.textContent || '').trim() === '声明原创');
              if (confirmBtn) {
                return { detected: true, reason: '检测到弹窗【声明原创】按钮' };
              }
            }

            return { detected: false, reason: '' };
          });

          if (detectRes && detectRes.detected) {
            dialogDetected = true;
            detectReason = detectRes.reason;
            break;
          }
        }

        if (dialogDetected) {
          await sleep(500);
          await tracer.track(`✅ 已检测到【原创权益】弹窗完全展开 (${detectReason})！`, null, 'success');

          // 第一阶段：检查并处理条款协议勾选（精准点中复选框小方块，严格避开蓝色超链接）
          for (let protoTry = 0; protoTry < 5; protoTry++) {
            const protoStatus = await client.evaluate(() => {
              const getRoots = () => {
                const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
                const iframes = Array.from(document.querySelectorAll('iframe'));
                for (const f of iframes) {
                  try {
                    if (f.contentDocument) {
                      const r = f.getBoundingClientRect();
                      roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                    }
                  } catch { }
                }
                return roots;
              };

              const roots = getRoots();
              for (const { doc, offsetX, offsetY } of roots) {
                const proto = doc.querySelector('.declare-original-dialog .original-proto-wrapper') ||
                  doc.querySelector('.original-proto-wrapper');
                if (!proto) continue;

                const isChecked = Boolean(
                  proto.querySelector('.ant-checkbox-wrapper-checked, .ant-checkbox-checked, .is-checked, input:checked') ||
                  proto.classList.contains('ant-checkbox-wrapper-checked')
                );

                if (isChecked) {
                  return { found: true, checked: true };
                }

                // 核心：精准锁定复选框的方块图元，绝对不能点文本避免误点《原创声明须知》链接！
                const box: any = proto.querySelector('.ant-checkbox-inner, .ant-checkbox, input[type="checkbox"]') ||
                  proto.querySelector('label.ant-checkbox-wrapper') || proto;
                box.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                const r = box.getBoundingClientRect();

                return {
                  found: true,
                  checked: false,
                  // 若为独立小方块取中心；若为包含文字的整行 label 则靠左偏移 10px 绝对命中方块
                  x: Math.round(r.left + offsetX + (r.width > 26 ? 12 : r.width / 2)),
                  y: Math.round(r.top + offsetY + r.height / 2)
                };
              }
              return { found: false, checked: true };
            });

            if (protoStatus.checked) {
              await tracer.track('✅ [原创条款] 条款协议已处于同意勾选状态', null, 'success');
              break;
            } else if (protoStatus.x && protoStatus.y) {
              await tracer.track(`[原创条款] 正在物理点击勾选《原创声明须知》协议方块 (坐标: ${protoStatus.x}, ${protoStatus.y})...`);
              await cdpClick(protoStatus.x, protoStatus.y);
              await sleep(600);
            }
          }

          // 第二阶段：定位弹窗底部的【声明原创】按钮并执行确认点击
          await tracer.track('正在定位弹窗底部【声明原创】按钮...');
          let confirmClicked = false;

          for (let attempt = 0; attempt < 10; attempt++) {
            const btnInfo = await client.evaluate(() => {
              const getRoots = () => {
                const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
                const iframes = Array.from(document.querySelectorAll('iframe'));
                for (const f of iframes) {
                  try {
                    if (f.contentDocument) {
                      const r = f.getBoundingClientRect();
                      roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                    }
                  } catch { }
                }
                return roots;
              };

              const roots = getRoots();
              for (const { doc, offsetX, offsetY } of roots) {
                const allBtns = Array.from(doc.querySelectorAll('button, .weui-desktop-btn'));
                const confirmBtn: any = doc.querySelector('.declare-original-dialog .weui-desktop-btn_primary') ||
                  allBtns.find(b => (b.textContent || '').trim() === '声明原创' && b.closest('.declare-original-dialog, .weui-desktop-dialog')) ||
                  allBtns.find(b => (b.textContent || '').trim() === '声明原创');

                if (!confirmBtn) continue;

                const isDisabled = confirmBtn.hasAttribute('disabled') ||
                  confirmBtn.classList.contains('weui-desktop-btn_disabled') ||
                  confirmBtn.classList.contains('is-disabled') ||
                  confirmBtn.getAttribute('aria-disabled') === 'true';

                confirmBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
                const r = confirmBtn.getBoundingClientRect();

                return {
                  found: true,
                  disabled: isDisabled,
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                  width: r.width,
                  height: r.height
                };
              }

              return { found: false, reason: '未找到【声明原创】确认按钮' };
            });

            if (btnInfo.found && !btnInfo.disabled && btnInfo.x && btnInfo.y) {
              await tracer.track(`[声明原创] 正在物理点击确认【声明原创】按钮 (坐标: ${btnInfo.x}, ${btnInfo.y})...`);
              await cdpClick(btnInfo.x, btnInfo.y);
              await sleep(1000);

              // 验证弹窗是否关闭
              const isClosed = await client.evaluate(() => {
                const dialogWrap = document.querySelector('.declare-original-dialog');
                if (!dialogWrap) return true;
                const dialog = dialogWrap.querySelector('.weui-desktop-dialog');
                if (!dialog) return true;
                const wrp = dialogWrap.querySelector('.weui-desktop-dialog__wrp');
                const isHidden = dialogWrap.classList.contains('hide') ||
                  (wrp && (wrp as any).style && (wrp as any).style.display === 'none') ||
                  window.getComputedStyle(dialogWrap).display === 'none';
                return Boolean(isHidden);
              });

              if (isClosed) {
                confirmClicked = true;
                break;
              }
            } else if (btnInfo.found && btnInfo.disabled) {
              await tracer.track('[声明原创] ⚠️ 确认按钮当前为禁用状态，等待协议生效解锁...', null, 'warn');
              await sleep(500);
            } else {
              await sleep(400);
            }
          }

          if (confirmClicked) {
            await tracer.track('🎉 [声明原创] ✅ 弹窗中成功确认【声明原创】，弹窗已关闭！', null, 'success');
            origConfirmed = true;
          } else {
            await tracer.track('[声明原创] ⚠️ 确认按钮处于禁用状态或未完成确认，正在关闭弹窗并略过原创声明', null, 'warn');
            // 如果弹窗依然存在，尝试点击关闭或取消按钮，避免遮挡页面后续表单项
            await client.evaluate(() => {
              const dialog = document.querySelector('.declare-original-dialog, .weui-desktop-dialog');
              if (dialog) {
                const cancelBtn: any = dialog.querySelector('.weui-desktop-btn_default, .weui-desktop-icon-btn_close, button.close, [aria-label="Close"]');
                if (cancelBtn) cancelBtn.click();
              }
            });
            await sleep(400);
          }
        } else {
          const checkStatus = await client.evaluate(() => {
            const cb = document.querySelector('.declare-original-checkbox');
            if (cb) {
              const input: any = cb.querySelector('input[type="checkbox"]');
              return Boolean(cb.querySelector('.ant-checkbox-checked, .is-checked') || (input && input.checked));
            }
            return false;
          });

          if (checkStatus) {
            await tracer.track('✅ [声明原创] 复选框已勾选生效', null, 'success');
            origConfirmed = true;
          } else {
            await tracer.track('[声明原创] ⚠️ 复选框未处于勾选状态', null, 'warn');
          }
        }
      } else {
        await tracer.track(`[声明原创] ⚠️ 未能定位复选框: ${origTriggerInfo?.reason || '未能在页面中定位到有效复选框'}`, null, 'warn');
      }

      // 如果未能成功开启或确认原创声明（如按钮禁用或类目不符），记录日志并跳过，继续后续流程
      if (!origConfirmed) {
        await tracer.track('[声明原创] ⚠️ 未能成功开启或确认原创声明（可能按钮为禁用状态或已免审），跳过继续后续发布流程', null, 'warn');
      }
    } catch (e: any) {
      await tracer.track(`[声明原创] 处理略过: ${e.message}`, null, 'warn');
    }

    // 5. 视频标注：精确定位 .post-with-mark-tag，展开下拉菜单并选择【含AI生成内容】
    await tracer.track('正在检查并配置【视频标注】(设置为"含AI生成内容")...');
    await sleep(400);

    let markTagDone = false;
    for (let mTry = 0; mTry < 6; mTry++) {
      // 第一阶段：多根穿透定位 .post-with-mark-tag / .mark-tag-select，检测是否已选中或获取展开触发坐标
      const markTagInfo = await client.evaluate(() => {
        const isAiMark = (txt: string) => {
          if (!txt) return false;
          const t = txt.trim().toLowerCase();
          if (t.includes('无需') || t.includes('no mark') || t.includes('not required') || t.includes('虚构') || t.includes('entertainment')) return false;
          return t.includes('含ai') || t.includes('ai生成') || t.includes('contains ai') || t.includes('ai-generated') || t.includes('ai generated') || t.includes('generated content');
        };

        const getRoots = () => {
          const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
          for (const f of Array.from(document.querySelectorAll('iframe'))) {
            try {
              if (f.contentDocument) {
                const r = f.getBoundingClientRect();
                roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
              }
            } catch { }
          }
          return roots;
        };

        const roots = getRoots();
        for (const { doc, offsetX, offsetY } of roots) {
          const wrap = (doc.querySelector('.post-with-mark-tag') ||
            Array.from(doc.querySelectorAll('*')).find(el => {
              const t = (el.textContent || '').trim();
              return (t === '视频标注' || t === 'Video Mark' || t === 'Content Tag') && el.children.length === 0;
            })?.closest('.form-item') ||
            doc.querySelector('.mark-tag-select')?.closest('.form-item')) as HTMLElement | null;

          if (!wrap) continue;

          // 确保组件已平滑滚动到视口中央
          wrap.scrollIntoView({ behavior: 'auto', block: 'center' });

          const selectWrap = wrap.querySelector('.mark-tag-select') as HTMLElement | null;
          const selectValueEl = wrap.querySelector('.select-value') as HTMLElement | null;
          const currentVal = (selectValueEl ? selectValueEl.textContent || '' : '').trim();

          // 检查当前是否已经是【含AI生成内容】/【Contains AI-generated content】
          if (isAiMark(currentVal) || (selectWrap && selectWrap.classList.contains('has-value') && isAiMark(currentVal))) {
            return { found: true, alreadySelected: true, currentVal };
          }

          // 检查下拉列表当前是否已经处于展开可见状态
          const optionsPanel = (wrap.querySelector('.mark-tag-options') || doc.querySelector('.mark-tag-options')) as HTMLElement | null;
          const isOptionsOpen = Boolean(optionsPanel && optionsPanel.style.display !== 'none' && window.getComputedStyle(optionsPanel).display !== 'none');

          // 定位展开触发器：.select-display, .select-arrow, .mark-tag-select（只读取坐标，不在此处执行click，避免与外层cdpClick重复翻转）
          const trigger = (wrap.querySelector('.select-display') || wrap.querySelector('.select-arrow') || wrap.querySelector('.mark-tag-select') || wrap) as HTMLElement;
          const r = trigger.getBoundingClientRect();

          return {
            found: true,
            alreadySelected: false,
            isOptionsOpen,
            currentVal,
            triggerX: Math.round(r.left + offsetX + r.width / 2),
            triggerY: Math.round(r.top + offsetY + r.height / 2)
          };
        }

        return { found: false, reason: '未找到【视频标注】组件容器 (.post-with-mark-tag)' };
      });

      if (markTagInfo.alreadySelected) {
        await tracer.track(`✅ [视频标注] 当前已设置为: 【${markTagInfo.currentVal}】`, null, 'success');
        markTagDone = true;
        break;
      }

      if (markTagInfo.found) {
        // 若下拉选项尚未展开，通过真实的 CDP 鼠标单次点击展开
        if (!markTagInfo.isOptionsOpen && markTagInfo.triggerX && markTagInfo.triggerY) {
          await tracer.track(`[视频标注] 点击展开选项列表 (坐标: ${markTagInfo.triggerX}, ${markTagInfo.triggerY})...`);
          await cdpClick(markTagInfo.triggerX, markTagInfo.triggerY);
          await sleep(600);
        }

        // 第二阶段：在展开的 .mark-tag-options 或全局中精确定位【含AI生成内容】并点击
        const optionClickInfo = await client.evaluate(() => {
          const isAiMark = (txt: string) => {
            if (!txt) return false;
            const t = txt.trim().toLowerCase();
            if (t.includes('无需') || t.includes('no mark') || t.includes('not required') || t.includes('虚构') || t.includes('entertainment')) return false;
            return t.includes('含ai') || t.includes('ai生成') || t.includes('contains ai') || t.includes('ai-generated') || t.includes('ai generated') || t.includes('generated content');
          };

          const getRoots = () => {
            const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentDocument) {
                  const r = f.getBoundingClientRect();
                  roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                }
              } catch { }
            }
            return roots;
          };

          const roots = getRoots();
          for (const { doc, offsetX, offsetY } of roots) {
            const options = Array.from(doc.querySelectorAll('.mark-tag-option, .mark-tag-options .option-main, .post-with-mark-tag .mark-tag-options div')) as HTMLElement[];
            for (const opt of options) {
              const mainTxt = (opt.querySelector('.option-main')?.textContent || opt.textContent || '').trim();
              if (isAiMark(mainTxt)) {
                opt.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                const r = opt.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  return {
                    found: true,
                    targetText: mainTxt,
                    x: Math.round(r.left + offsetX + r.width / 2),
                    y: Math.round(r.top + offsetY + r.height / 2)
                  };
                }
              }
            }
          }
          return { found: false };
        });

        if (optionClickInfo.found && optionClickInfo.x && optionClickInfo.y) {
          await tracer.track(`[视频标注] 物理点击目标选项: 【${optionClickInfo.targetText}】...`);
          await cdpClick(optionClickInfo.x, optionClickInfo.y);
          await sleep(600);
        } else {
          // 如果通过 CDP 坐标未点到，尝试用 DOM 事件分发直接选中
          await client.evaluate(() => {
            const isAiMark = (txt: string) => {
              if (!txt) return false;
              const t = txt.trim().toLowerCase();
              if (t.includes('无需') || t.includes('no mark') || t.includes('not required') || t.includes('虚构') || t.includes('entertainment')) return false;
              return t.includes('含ai') || t.includes('ai生成') || t.includes('contains ai') || t.includes('ai-generated') || t.includes('ai generated') || t.includes('generated content');
            };
            const opts = Array.from(document.querySelectorAll('.mark-tag-option, .mark-tag-options div'));
            for (const o of opts) {
              const txt = (o.textContent || '').trim();
              if (isAiMark(txt)) {
                (o as HTMLElement).click();
                o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                o.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                o.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                break;
              }
            }
          });
          await sleep(500);
        }

        // 第三阶段：校验最终选中状态
        const verifyResult = await client.evaluate(() => {
          const isAiMark = (txt: string) => {
            if (!txt) return false;
            const t = txt.trim().toLowerCase();
            if (t.includes('无需') || t.includes('no mark') || t.includes('not required') || t.includes('虚构') || t.includes('entertainment')) return false;
            return t.includes('含ai') || t.includes('ai生成') || t.includes('contains ai') || t.includes('ai-generated') || t.includes('ai generated') || t.includes('generated content');
          };
          const valEl = document.querySelector('.post-with-mark-tag .select-value, .mark-tag-select .select-value') as HTMLElement | null;
          const valTxt = (valEl ? valEl.textContent || '' : '').trim();
          const isSelectedEl = document.querySelector('.mark-tag-option.is-selected .option-main, .mark-tag-option.is-selected');
          const selTxt = (isSelectedEl ? isSelectedEl.textContent || '' : '').trim();
          const selectWrap = document.querySelector('.mark-tag-select');
          return {
            success: isAiMark(valTxt) || isAiMark(selTxt) || Boolean(selectWrap && selectWrap.classList.contains('has-value') && isAiMark(valTxt)),
            displayValue: valTxt || selTxt
          };
        });

        if (verifyResult.success) {
          await tracer.track(`✅ [视频标注] 已成功设置为: 【${verifyResult.displayValue || '含AI生成内容'}】！`, null, 'success');
          markTagDone = true;
          break;
        }
      } else {
        await tracer.track(`[视频标注] ℹ️ 尝试第 ${mTry + 1} 次定位组件...`);
      }

      await sleep(600);
    }

    // 核心规则：如果未能确认视频标注选中状态，坚决终止任务！
    if (!markTagDone) {
      await tracer.track('❌ [视频标注] 未能成功设置为【含AI生成内容】，已强行终止发布以防违规！', null, 'error', { persistent: true });
      throw new Error('微信视频号【视频标注】未能成功设置为【含AI生成内容】，已中止发布任务！');
    }
  }

  /**
   * 执行完整的自动化视频发布流程（直连 CDP 页面控制器 + 全链路追踪）
   */
  async executePublish(
    adapter: PlatformTabAdapter,
    localVideoPath: string,
    payload: PublishPayload,
    onStatusUpdate?: (status: string) => void,
    lang?: string
  ): Promise<PlatformPublishResult> {
    const activeLang = this.getCurrentLang(lang);
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;
    let client: CdpPageClient | null = null;

    const checkAborted = () => {
      if (signal.aborted || adapter.isClosed() || adapter.webContents.isDestroyed()) {
        throw new PublishAbortedError(this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }), activeLang);
      }
    };

    try {
      checkAborted();

      const tracer = new ActionTracer({
        platform: 'wechat',
        webContents: adapter.webContents,
        steps: getPlatformPublishSteps('wechat', activeLang),
        onStatusUpdate,
        signal,
        lang: activeLang,
      });

      await tracer.track('🚀 微信视频号自动化发布流程启动', {
        目标地址: this.publishUrl,
        视频文件: localVideoPath || '未提供视频',
        标题: payload.title,
      });

      adapter.show();
      adapter.focus();

      // 初始化步骤条并标记步骤 0 (页面就绪) 为 active
      await tracer.updateStep(0, 'active');

      // 1. 直连目标页面 CDP WebSocket（零延迟秒连）
      try {
        checkAborted();
        client = await adapter.getCdpClient();
        tracer.setClient(client);
        await tracer.track('成功建立专属页面 CDP WebSocket 连接', { TargetId: client.targetInfo.id, URL: client.url() }, 'success');
      } catch (cdpErr: any) {
        checkAborted();
        await tracer.updateStep(0, 'error');
        await tracer.track(`连接 CDP WebSocket 失败: ${cdpErr.message}`, cdpErr.stack, 'error');
        return { success: false, platform: 'wechat', message: cdpErr.message };
      }

      checkAborted();

      // 2. 检查登录状态
      let pageState = await this.detectPageState(adapter.webContents);
      await tracer.track('诊断当前登录状态', pageState);

      // 2. 严格核验登录状态：若初步未检测到登录，先执行一次整页刷新自愈重测（唤醒本地 Cookie 握手）
      if (!pageState.isLoggedIn) {
        checkAborted();
        await tracer.track('⏳ 初步检测到登录态可能失活，正在执行整页刷新自愈重测...');
        adapter.webContents.reload();
        await sleep(2500, signal);
        while (adapter.webContents.isLoading()) {
          checkAborted();
          await sleep(500, signal);
        }
        await sleep(1500, signal);
        checkAborted();
        pageState = await this.detectPageState(adapter.webContents);
        if (pageState.isLoggedIn) {
          await tracer.track('🎉 整页刷新自愈成功，登录态已满血恢复！', null, 'success');
        }
      }

      // 若自愈后仍未登录，则坚决停留等待用户扫码，严禁擅自执行下一步！
      if (!pageState.isLoggedIn) {
        checkAborted();
        await tracer.updateStep(0, 'active');
        await tracer.track('⏳ 检测到微信视频号尚未登录，请在窗口中使用微信扫码登录 (登录成功后将自动继续)...', null, 'warn', { persistent: true });
        const loggedIn = await this.waitForLogin(adapter.webContents, tracer, 300000, signal);
        if (!loggedIn) {
          checkAborted();
          await tracer.updateStep(0, 'error');
          await tracer.track('❌ 微信视频号登录超时或未完成扫码，自动化流程强行终止！', null, 'error', { persistent: true });
          return { success: false, platform: 'wechat', message: this.formatLog('微信视频号未登录或登录超时，已终止后续自动化操作', activeLang) };
        }
        checkAborted();
        await tracer.track('🎉 检测到用户已成功扫码登录微信视频号！正在准备跳转发表界面...', null, 'success');
        await sleep(2000, signal);
        pageState = await this.detectPageState(adapter.webContents);
      }

      // 3. 拟人化进入发表页面（优先点击右上角【发表视频】按钮，备用通过 URL 导航）
      await tracer.track('🚀 确认登录成功，准备从管理页进入新建视频发表界面...');
      await this.navigateToNewPostPage(client, tracer, adapter);

      // 确定性核验：确保 URL 真正进入 /post/create
      const checkPostUrl = await client.evaluate(() => location.href).catch(() => '');
      if (!checkPostUrl.includes('/post/create')) {
        await tracer.track('⏳ 正在通过发表页 URL 强行导航确保进入发表页...');
        await adapter.loadURL(this.publishUrl);
        await sleep(2000);
      }

      // 刷新 CDP 客户端连接，确保 Target 处于最新发表页面
      await sleep(1500);
      while (adapter.webContents.isLoading()) {
        await sleep(500);
      }
      try {
        client = await adapter.getCdpClient();
        tracer.setClient(client);
      } catch { }

      // 关键卡点：必须严格等待页面彻底渲染就绪，绝不抢跑！
      checkAborted();
      await this.waitForPublishPageReady(client, tracer, 35000, signal);
      checkAborted();

      // 用户要求：网页就绪后提示“网络就绪”，模拟人的行为等待3-5秒，再做下一个动作
      await tracer.track('🌐 网络就绪！微信视频号发表界面已加载完成', null, 'success');
      await waitHumanInterval(tracer, 3000, 5000, '网络就绪，正在模拟人工审视发表页面');

      // 串行动作 [步骤 1/6]：清理遮罩与弹窗
      await tracer.track('[步骤 1/6] 检查并清理页面弹窗与公约遮罩...');
      await this.dismissDialogs(client, tracer);
      await waitHumanInterval(tracer, 1000, 3000, '[步骤 1/6 完成] 准备执行页面输入控件深度诊断');

      // 串行动作 [步骤 2/6]：深度诊断当前页面 DOM 元素
      await tracer.track('[步骤 2/6] 执行页面 DOM 结构与输入表单深度诊断...');
      await tracer.diagnosePageInputs(client);
      await waitHumanInterval(tracer, 1000, 3000, '[步骤 2/6 完成] DOM 诊断完毕，准备注入短视频素材');

      // 步骤 0 (页面就绪) 完成，进入步骤 1 (视频上传)
      await tracer.updateStep(0, 'done');
      await tracer.updateStep(1, 'active');

      // 串行动作 [步骤 3/6]：原生上传本地短视频素材
      await tracer.track('[步骤 3/6] 注入本地短视频素材...');
      if (localVideoPath && fs.existsSync(localVideoPath)) {
        const uploaded = await this.uploadVideoViaCdp(client, localVideoPath, tracer);
        if (uploaded) {
          await tracer.track('视频素材已成功注入，微信正在解析与生成缩略图...', null, 'success');
          // 关键核心：等待微信解析视频完成并成功展现出右侧短标题与描述表单
          const formReady = await this.waitForEditFormReady(client, tracer, 30000);
          if (!formReady) {
            await tracer.updateStep(1, 'error');
            await tracer.track('❌ 等待微信解析视频与编辑表单挂载超时，发布流程强行终止！', null, 'error', { persistent: true });
            return {
              success: false,
              platform: 'wechat',
              message: this.formatLog('视频解析与编辑表单挂载超时，已终止后续发布操作', activeLang),
            };
          }

          // 激活视频首帧纹理，确保视频预览框画面立即可见，杜绝黑块假象
          await client.evaluate(() => {
            const v = document.querySelector('video') as HTMLVideoElement | null;
            if (v) {
              try {
                if (v.paused && v.currentTime === 0 && v.duration > 0.05) {
                  v.currentTime = 0.05;
                }
              } catch { }
            }
          }).catch(() => null);
        } else {
          await tracer.updateStep(1, 'error');
          await tracer.track('❌ 未能自动触发上传控件，注入本地短视频失败，发布流程强行终止！', null, 'error', { persistent: true });
          return {
            success: false,
            platform: 'wechat',
            message: this.formatLog('未能自动触发视频上传控件，已终止后续发布操作', activeLang),
          };
        }
      } else {
        await tracer.updateStep(1, 'error');
        await tracer.track('❌ 未找到本地短视频文件，发布流程强行终止！', { 路径: localVideoPath }, 'error', { persistent: true });
        return {
          success: false,
          platform: 'wechat',
          message: this.formatLog('未找到本地视频文件，已终止后续发布操作', activeLang),
        };
      }

      await tracer.updateStep(1, 'done');
      await waitHumanInterval(tracer, 1000, 3000, '[步骤 3/6 完成] 视频素材处理完毕，准备写入短标题');

      // 串行动作 [步骤 4/6]：填入短标题（平台严格限制不超过 16 字，超长自动截断）
      await tracer.updateStep(2, 'active');
      const rawTitle = (payload.title || '')
        .replace(/#[\w\u4e00-\u9fa5]+/g, '')
        .replace(/[\r\n\t]+/g, ' ')
        .trim();
      const cleanShortTitle = rawTitle.slice(0, 16);

      if (cleanShortTitle) {
        await tracer.track('[步骤 4/6] 开始录入视频短标题 (限16字)...', {
          原始标题: rawTitle,
          截断后短标题: cleanShortTitle,
          字数: cleanShortTitle.length,
        });
        const titleCandidates = [
          'input[placeholder*="短标题"]',
          'input[placeholder*="标题"]',
          'input[placeholder*="添加短标题"]',
          '.weui-desktop-form__control-group input',
          '.weui-desktop-form__input',
          'input[type="text"]',
        ];
        const titleSuccess = await tracer.smartFillInput(client, '短标题', titleCandidates, cleanShortTitle, { maxLength: 16 });
        if (!titleSuccess) {
          await tracer.updateStep(2, 'error');
          await tracer.track('❌ 短标题输入控件未能定位或填入失败，发布流程强行终止！', null, 'error', { persistent: true });
          return {
            success: false,
            platform: 'wechat',
            message: this.formatLog('未定位到短标题输入控件，为防止异常发布已终止后续流程', activeLang),
          };
        }

        // 完成输入以后专项核验：如果内容超过 16 个字符，把多余的字符删除掉
        const titleStatus = await client.evaluate(() => {
          const allInputs = Array.from(document.querySelectorAll('input'));
          const input = allInputs.find((i) => {
            const ph = (i.placeholder || '').trim();
            const p = i.closest('.weui-desktop-form__control-group') || i.parentElement;
            const label = p ? (p.textContent || '') : '';
            return ph.includes('短标题') || label.includes('短标题');
          });
          const currentVal = input ? input.value : '';
          const bodyText = document.body ? document.body.innerText : '';
          const hasExceedError = bodyText.includes('标题超过16字限制') || currentVal.length > 16;
          let coord: { x: number; y: number } | null = null;
          if (input) {
            const r = input.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              coord = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
          }
          return {
            currentVal,
            length: currentVal.length,
            hasExceedError,
            coord,
          };
        }).catch(() => ({ currentVal: '', length: 0, hasExceedError: false, coord: null }));

        if (titleStatus.hasExceedError || titleStatus.length > 16) {
          const excess = Math.max(1, titleStatus.length - 16);
          await tracer.track(`[短标题校验] ⚠️ 检测到输入框内容字数 (${titleStatus.length}) 超过 16 字符，正在执行退格删除多余字符...`, {
            当前内容: titleStatus.currentVal,
            超长字数: excess,
          }, 'warn');

          if (titleStatus.coord) {
            await client.mouseClick(titleStatus.coord.x, titleStatus.coord.y);
            await sleep(100);
          }
          await client.pressEnd();
          await client.backspace(excess);
          await waitHumanInterval(tracer, 300, 600, '完成多余字符退格删除，核验最终结果');

          // 二次校验
          const recheck = await client.evaluate(() => {
            const allInputs = Array.from(document.querySelectorAll('input'));
            const input = allInputs.find((i) => {
              const ph = (i.placeholder || '').trim();
              const p = i.closest('.weui-desktop-form__control-group') || i.parentElement;
              const label = p ? (p.textContent || '') : '';
              return ph.includes('短标题') || label.includes('短标题');
            });
            const val = input ? input.value : '';
            return {
              val,
              length: val.length,
              hasExceedError: document.body.innerText.includes('标题超过16字限制') || val.length > 16,
            };
          }).catch(() => ({ val: '', length: 0, hasExceedError: false }));

          if (recheck.hasExceedError || recheck.length > 16) {
            await tracer.track('[短标题校验] 退格后仍超长，执行安全重置并仅录入合规短标题 (严格单次，限16字)...', null, 'warn');
            await client.selectAllAndClear();
            await client.typeTextHumanLike(cleanShortTitle.slice(0, 16), { enableTypo: false });
          }
        }

        await tracer.updateStep(2, 'done');
        await waitHumanInterval(tracer, 1000, 3000, '[步骤 4/6 完成] 短标题填入完毕，准备录入视频简介与话题');
      } else {
        await tracer.updateStep(2, 'done');
      }

      // 串行动作 [步骤 5/6]：填入视频简介与话题标签
      await tracer.updateStep(3, 'active');
      const topicTags =
        payload.tags && payload.tags.length > 0
          ? `\n\n${payload.tags.map((t) => `#${t.replace(/^#/, '')} `).join('')}`
          : '';
      const descContent = `${(payload.description || payload.title || '').trim()}${topicTags}`.trim();

      if (descContent) {
        await tracer.track('[步骤 5/6] 开始录入视频简介与话题标签...');
        const editorCandidates = [
          '[contenteditable]',
          '.input-editor',
          '[role="textbox"]',
          'div[data-placeholder*="描述"]',
          'div[data-placeholder*="话题"]',
          'div[placeholder*="描述"]',
          'div[placeholder*="话题"]',
          '.weui-desktop-form [contenteditable]',
          '.weui-desktop-form__control-group [contenteditable]',
          'textarea',
        ];
        const descSuccess = await tracer.smartFillEditor(client, '视频简介与话题', editorCandidates, descContent);
        if (!descSuccess) {
          await tracer.updateStep(3, 'error');
          await tracer.track('❌ 视频简介与话题编辑框未能定位或填入失败，发布流程强行终止！', null, 'error', { persistent: true });
          return {
            success: false,
            platform: 'wechat',
            message: this.formatLog('未定位到视频简介与话题编辑框，为防止异常发布已终止后续流程', activeLang),
          };
        }
        await tracer.updateStep(3, 'done');
        await waitHumanInterval(tracer, 1000, 3000, '[步骤 5/6 完成] 文案与话题已注入，准备配置高级发布选项');
      } else {
        await tracer.updateStep(3, 'done');
      }

      // 串行动作 [步骤 4/5 对应的高级设置]：配置高级发布选项（位置 / 合集 / 原创声明 / AI 标注 / 定时发表）
      await tracer.updateStep(4, 'active');
      try {
        await this.configureAdvancedOptions(client, tracer, payload);
        await tracer.updateStep(4, 'done');
        await waitHumanInterval(tracer, 1000, 2000, '高级发布选项配置完毕');
      } catch (optErr: any) {
        if (optErr instanceof PublishAbortedError || optErr?.isAborted || signal.aborted || adapter.isClosed() || tracer.isAborted()) {
          throw optErr;
        }
        await tracer.updateStep(4, 'error');
        await tracer.track(`❌ [发布终止] 高级发布选项未达标已强制中止发布: ${optErr.message}`, null, 'error', { persistent: true });
        return {
          success: false,
          platform: 'wechat',
          message: `发布已强行中止: ${optErr.message}`,
        };
      }

      // 拟人通篇复核动作：所有信息填写完成以后，先上翻页到顶部，停留 2-3 秒，然后再回到底部，停 1-2 秒
      await tracer.track('📜 [发布复核] 表单与高级选项配置完毕，正在平滑上翻页到顶部 (停留 2-3 秒)...');
      try {
        await client.evaluate(() => {
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
          try { document.documentElement?.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
          try { document.body?.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
        });
        await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 300, deltaX: 0, deltaY: -600 });
      } catch { }

      await waitHumanInterval(tracer, 2000, 3000, '已处于发表页顶部，正在通篇审视视频封面与文案');

      // 然后再回到底部
      await tracer.track('📜 [发布复核] 通篇审视完毕，正在平滑回到底部 (停留 1-2 秒)...');
      try {
        await client.evaluate(() => {
          const maxH = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, 99999);
          try { window.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
          try { document.documentElement?.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
          try { document.body?.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
        });
        await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 500, deltaX: 0, deltaY: 600 });
      } catch { }

      await waitHumanInterval(tracer, 1000, 2000, '已回到底部发表区域，准备监测转码与校验按钮');

      // 串行动作 [步骤 5/5 对应的转码与发布]：监测视频转码状态与发表按钮校验
      await tracer.updateStep(5, 'active');
      await tracer.track('[步骤 6/6] 监测视频上传转码状态，校验发布按钮激活状态...');

      let canPublish = false;
      let retryUploadCount = 0;
      const maxUploadRetries = 1;
      let lastReportedProgress = '';
      let lastProgressLogTime = 0;
      let uploadActiveStart = Date.now();
      const MAX_UPLOAD_WAIT_MS = 15 * 60 * 1000; // 最大支持 15 分钟上传

      for (let i = 0; i < 300; i++) {
        if (signal.aborted || adapter.isClosed() || tracer.isAborted()) {
          throw new PublishAbortedError(this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }), activeLang);
        }

        // 若整体等待超过 15 分钟兜底退出
        if (Date.now() - uploadActiveStart > MAX_UPLOAD_WAIT_MS) {
          await tracer.track('❌ 等待微信视频上传超过最大时限 (15分钟)，已终止发表流程', null, 'error', { persistent: true });
          break;
        }

        try {
          // 核心监测 1：全面精准监测视频上传真实状态 (上传中 / 上传失败 / 正常就绪)
          const uploadState = await client.evaluate(() => {
            const bodyText = document.body ? document.body.innerText : '';

            // A. 致命上传失败特征（包含“网络出错，请重新上传。”与红色错误提示）
            const isFailed =
              bodyText.includes('网络出错') ||
              bodyText.includes('请重新上传') ||
              bodyText.includes('视频上传失败') ||
              bodyText.includes('上传失败') ||
              bodyText.includes('视频格式不支持') ||
              bodyText.includes('文件已损坏');

            // B. 正在上传/转码中（带有百分比或转码状态）
            const pctMatches = bodyText.match(/(\d{1,3})%/g) || [];
            let detectedPct: string | null = null;
            for (const match of pctMatches) {
              const num = parseInt(match, 10);
              if (!isNaN(num) && num > 0 && num < 100) {
                detectedPct = `${num}%`;
                break;
              }
            }

            const hasProgressDom = Boolean(
              document.querySelector('.weui-desktop-progress, .weui-progress, [class*="progress"], [class*="upload-progress"]')
            );

            const isUploading = Boolean(
              detectedPct ||
              hasProgressDom ||
              bodyText.includes('上传中') ||
              bodyText.includes('正在上传') ||
              bodyText.includes('转码中') ||
              bodyText.includes('正在转码') ||
              bodyText.includes('正在校验') ||
              bodyText.includes('正在解析')
            );

            // C. 定位视频删除或重新上传按钮
            let deleteCoord: { x: number; y: number } | null = null;
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            const delBtn = all.find((el) => {
              const cls = (el.className || '').toString();
              const txt = (el.textContent || '').trim();
              const isDel =
                cls.includes('delete') ||
                cls.includes('trash') ||
                cls.includes('remove') ||
                txt === '删除' ||
                txt === '重新上传' ||
                txt === '替换视频';
              return isDel && el.children.length <= 2 && el.offsetParent !== null;
            });
            if (delBtn) {
              const r = delBtn.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                deleteCoord = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              }
            }

            return {
              isFailed,
              isUploading,
              uploadProgress: detectedPct || (bodyText.includes('上传中') ? '上传中' : null),
              deleteCoord,
            };
          }).catch(() => null);

          // 如果检测到视频上传失败：用户规则——先删除视频，然后再重新上传一次！
          if (uploadState?.isFailed) {
            if (retryUploadCount < maxUploadRetries && localVideoPath && fs.existsSync(localVideoPath)) {
              retryUploadCount++;
              await tracer.track(`⚠️ 检测到微信视频上传失败 (网络出错/请重新上传)，准备先删除视频再重新上传 (第 ${retryUploadCount} 次重试)...`, null, 'warn', { persistent: true });

              // 1. 如果能找到删除按钮，物理点击删除并处理确认弹窗
              if (uploadState.deleteCoord) {
                await client.mouseClick(uploadState.deleteCoord.x, uploadState.deleteCoord.y);
                await sleep(800);
                // 检查确认弹窗
                await client.evaluate(() => {
                  const btns = Array.from(document.querySelectorAll('.weui-desktop-btn_primary, button')) as HTMLElement[];
                  const ok = btns.find((b) => (b.textContent || '').trim() === '确定' || (b.textContent || '').trim() === '确认');
                  if (ok) ok.click();
                }).catch(() => { });
                await sleep(1500);
              }

              // 2. 重新通过原生 CDP 注入视频文件
              await tracer.track('正在重新注入本地短视频素材并等待上传...');
              await this.uploadVideoViaCdp(client, localVideoPath, tracer);
              await sleep(3000);
              i = 0; // 重置检查计数器，重新进入完整上传轮询
              uploadActiveStart = Date.now();
              continue;
            } else {
              // 已超过重试次数依然失败：坚决不要做发表操作！
              await tracer.updateStep(5, 'error');
              await tracer.track('❌ 微信视频上传失败（网络出错，请稍后重试），已坚决终止发表操作，避免提交空内容！', null, 'error', { persistent: true });
              return {
                success: false,
                platform: 'wechat',
                message: this.formatLog('微信视频上传失败: 网络出错，请稍后重试，已终止发表', activeLang),
              };
            }
          }

          // 如果仍在上传中：用户规则——持续等待视频上传成功！
          if (uploadState?.isUploading) {
            const currentProgress = uploadState.uploadProgress || '处理中';
            const now = Date.now();
            if (currentProgress !== lastReportedProgress || now - lastProgressLogTime > 6000) {
              await tracer.track(`⏳ 视频正在上传或转码中 (${currentProgress})，持续等待上传成功...`, null, 'info', { persistent: true });
              lastReportedProgress = currentProgress;
              lastProgressLogTime = now;
            }
            // 只要处于活跃上传状态，重置循环计数器，避免循环自然耗尽退出
            i = Math.min(i, 10);
            await sleep(2000, signal);
            continue;
          }

          // 核心监测 2：发表按钮状态与表单整体健康度核验
          const btnState = await client.evaluate(() => {
            const walkAll = (root: any): Element[] => {
              const res: Element[] = [];
              if (!root) return res;
              const list = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
              for (const el of list as Element[]) {
                res.push(el);
                if ((el as any).shadowRoot) res.push(...walkAll((el as any).shadowRoot));
                if (el.tagName === 'IFRAME') {
                  try {
                    const d = (el as HTMLIFrameElement).contentDocument;
                    if (d) res.push(...walkAll(d));
                  } catch { }
                }
              }
              return res;
            };

            const all = walkAll(document);
            const isPublishButtonText = (t: string) => {
              if (!t) return false;
              const s = t.trim().toLowerCase();
              return s === '发表' || s === '定时发表' || s === 'publish' || s === 'post' || s === 'schedule publish' || s === 'schedule post';
            };
            const pubBtn = all.find((el) => {
              const tag = el.tagName;
              const cls = (el.className && typeof el.className === 'string') ? el.className : '';
              const isBtn = tag === 'BUTTON' || cls.includes('weui-desktop-btn') || cls.includes('btn');
              const txt = (el.textContent || (el as any).innerText || '').trim();
              return isBtn && isPublishButtonText(txt);
            }) as HTMLButtonElement | undefined;

            if (!pubBtn) return { found: false, enabled: false };

            const isDisabled =
              (pubBtn as HTMLButtonElement).disabled ||
              pubBtn.getAttribute('disabled') !== null ||
              pubBtn.classList.contains('weui-desktop-btn_disabled') ||
              pubBtn.classList.contains('is-disabled') ||
              pubBtn.classList.contains('disabled') ||
              pubBtn.getAttribute('aria-disabled') === 'true';

            return { found: true, enabled: !isDisabled };
          });

          const pageHealth = await client.evaluate(() => {
            const bodyText = document.body ? document.body.innerText : '';
            const hasTitleError = bodyText.includes('标题超过16字限制') || bodyText.includes('超过16字');
            const hasFormError = hasTitleError || bodyText.includes('请填写完整') || bodyText.includes('内容包含违规');
            const isInitialUploadPage =
              (bodyText.includes('拖拽视频到此处') || bodyText.includes('上传时长8小时')) &&
              !bodyText.includes('封面预览') &&
              !bodyText.includes('短标题');

            return {
              hasTitleError,
              hasFormError,
              isInitialUploadPage,
            };
          }).catch(() => null);

          if (btnState.found && btnState.enabled && !uploadState?.isUploading && !uploadState?.isFailed) {
            if (pageHealth && pageHealth.hasFormError) {
              await tracer.track(`⚠️ 发表按钮可用，但表单仍有红字报错 (${pageHealth.hasTitleError ? '短标题超限' : '表单未完善'})，等待表单修正...`, null, 'warn');
            } else if (pageHealth && pageHealth.isInitialUploadPage) {
              await tracer.track('⚠️ 检测到页面处于未上传初始态，等待视频加载就绪...', null, 'warn');
            } else {
              canPublish = true;
              await tracer.track('✅ 视频已完整上传就绪、转码完成且表单无异常，“发表”按钮已就绪！', null, 'success');
              break;
            }
          }

          if (i > 0 && i % 4 === 0) {
            await tracer.track(`⏳ 正在等待微信完成视频解析或转码 (${Math.round(i * 1.5)}s)...`, null, 'info', { persistent: true });
          }
        } catch { }

        await sleep(1500, signal);
      }

      // 自动点击发表
      if (canPublish) {
        await waitHumanInterval(tracer, 1000, 2000, '[最终步骤] 视频转码与表单校验全部通过，准备自动点击发表');

        // 1. 模拟人类行为：发表之前，把页面移动到顶部持续 1-2 秒，再移动到最下面
        await tracer.track('📜 [最终步骤] 正在将页面平滑移动到顶部 (持续 1.5 秒，模拟人工通篇复核)...');
        try {
          await client.evaluate(() => {
            const smoothScrollToTop = (win: Window, doc: Document) => {
              try { win.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
              try { doc.documentElement?.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
              try { doc.body?.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
              // 扫描所有可滚动元素
              try {
                const all = Array.from(doc.querySelectorAll('*'));
                for (const el of all) {
                  if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
                    el.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }
              } catch { }
            };

            smoothScrollToTop(window, document);
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentWindow && f.contentDocument) {
                  smoothScrollToTop(f.contentWindow, f.contentDocument);
                }
              } catch { }
            }
          });
          // 配合真实鼠标滚轮向上滑
          await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 300, deltaX: 0, deltaY: -600 });
          // 顶部持续 1.5 秒
          await sleep(1500, signal);

          // 移动到最下面
          await tracer.track('📜 [最终步骤] 页面核对完毕，正在平滑移动到最下面操作区 (持续 1.5 秒)...');
          await client.evaluate(() => {
            const smoothScrollToBottom = (win: Window, doc: Document) => {
              const maxH = Math.max(doc.body?.scrollHeight || 0, doc.documentElement?.scrollHeight || 0, 99999);
              try { win.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
              try { doc.documentElement?.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
              try { doc.body?.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
              // 扫描所有可滚动元素
              try {
                const all = Array.from(doc.querySelectorAll('*'));
                for (const el of all) {
                  if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
                    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                  }
                }
              } catch { }
            };

            smoothScrollToBottom(window, document);
            for (const f of Array.from(document.querySelectorAll('iframe'))) {
              try {
                if (f.contentWindow && f.contentDocument) {
                  smoothScrollToBottom(f.contentWindow, f.contentDocument);
                }
              } catch { }
            }
          });
          // 配合真实鼠标滚轮向下滑
          await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 500, deltaX: 0, deltaY: 600 });
          // 底部平稳停顿 1.5 秒
          await sleep(1500, signal);
        } catch { }

        // ── 点击发表前最终上传状态二次核验 ──────────────────────────────────────────
        // 规则：在实际点击【发表】按钮之前，再做一次实时轮询确认：
        //   · 仍在上传中    → 每 3 秒轮询一次，直到上传完成方可点击发表
        //   · 上传失败      → 先删除视频再重传一次，重传后重新进入等待；仍失败则终止
        //   · evaluate 异常  → sleep 2s 后重试，不轻易认定上传完成
        //   · 超时（360s）  → 坚决终止，不做发表操作，避免提交异常内容
        // 注：使用独立的 finalRetryCount，不与前面循环的 retryUploadCount 共享
        // ────────────────────────────────────────────────────────────────────────────
        let finalUploadOk = false;
        let finalRetryCount = 0;    // 独立重试计数，不与前面 retryUploadCount 共享
        const maxFinalRetries = 1;
        for (let fwait = 0; fwait < 120; fwait++) {
          if (signal.aborted || adapter.isClosed() || tracer.isAborted()) {
            throw new PublishAbortedError(this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }), activeLang);
          }
          try {
            const uploadState = await client.evaluate(() => {
              const bodyText = document.body ? document.body.innerText : '';
              const isFailed =
                bodyText.includes('网络出错') ||
                bodyText.includes('请重新上传') ||
                bodyText.includes('视频上传失败') ||
                bodyText.includes('上传失败') ||
                bodyText.includes('视频格式不支持') ||
                bodyText.includes('文件已损坏');
              const matchPct = bodyText.match(/上传中\s*(\d+%)/);
              const isUploading = Boolean(
                matchPct ||
                bodyText.includes('上传中') ||
                bodyText.includes('正在上传') ||
                bodyText.includes('转码中') ||
                bodyText.includes('正在转码') ||
                bodyText.includes('正在校验')
              );
              // 仅当上传失败时才扫 DOM 找删除/重传按钮，减少正常轮询时的开销
              let deleteCoord: { x: number; y: number } | null = null;
              if (isFailed) {
                const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
                const delBtn = all.find((el) => {
                  const cls = (el.className || '').toString();
                  const txt = (el.textContent || '').trim();
                  return (
                    cls.includes('delete') ||
                    cls.includes('trash') ||
                    cls.includes('remove') ||
                    txt === '删除' ||
                    txt === '重新上传' ||
                    txt === '替换视频'
                  ) && el.children.length <= 2 && el.offsetParent !== null;
                });
                if (delBtn) {
                  const r = delBtn.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {
                    deleteCoord = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                  }
                }
              }
              return { isFailed, isUploading, uploadProgress: matchPct ? matchPct[1] : null, deleteCoord };
            }).catch(() => null);

            // 上传失败处理：先删除，再重新注入，重置计数器后继续等待
            if (uploadState === null) {
              // evaluate 异常，不轻易认定上传完成，等待并重试
              await sleep(2000, signal);
              continue;
            }
            if (uploadState.isFailed) {
              if (finalRetryCount < maxFinalRetries && localVideoPath && fs.existsSync(localVideoPath)) {
                finalRetryCount++;
                await tracer.track(`⚠️ [发表前最终检查] 检测到视频上传失败，正在执行删除重传 (第 ${finalRetryCount} 次)...`, null, 'warn', { persistent: true });
                // 1. 物理点击删除按钮
                if (uploadState.deleteCoord) {
                  await client.mouseClick(uploadState.deleteCoord.x, uploadState.deleteCoord.y);
                  await sleep(800);
                  // 2. 处理删除确认弹窗
                  await client.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('.weui-desktop-btn_primary, button')) as HTMLElement[];
                    const ok = btns.find((b) => (b.textContent || '').trim() === '确定' || (b.textContent || '').trim() === '确认');
                    if (ok) ok.click();
                  }).catch(() => { });
                  await sleep(1500);
                }
                // 3. 重新注入视频并等待上传启动
                await tracer.track('正在重新注入本地短视频素材，等待重新上传启动...');
                await this.uploadVideoViaCdp(client, localVideoPath, tracer);
                await sleep(5000); // 多等 5 秒让上传真正启动后再轮询
                fwait = -1; // 修正：continue 后 fwait++ 使其从 0 重新开始完整轮询
                continue;
              } else {
                await tracer.updateStep(5, 'error');
                await tracer.track('❌ [发表前最终检查] 视频上传失败且已无重试机会，坚决终止发表！', null, 'error', { persistent: true });
                return { success: false, platform: 'wechat', message: this.formatLog('微信视频上传失败: 网络出错，已终止发表', activeLang) };
              }
            }

            // 正在上传中：等待 3 秒后继续轮询，不点击发表
            if (uploadState.isUploading) {
              await tracer.track(`⏳ [发表前最终检查] 视频仍在上传中 (${uploadState.uploadProgress || '处理中'})，3 秒后重新检查...`, null, 'info', { persistent: true });
              await sleep(3000, signal);
              continue;
            }

            // 上传已完成且无失败标志：可以安全点击发表
            finalUploadOk = true;
            break;
          } catch { }
          await sleep(2000, signal);
        }

        // 超时兜底：360 秒内未完成上传，坚决终止发表，避免提交异常内容
        if (!finalUploadOk) {
          await tracer.updateStep(5, 'error');
          await tracer.track('❌ [发表前最终检查] 等待视频上传超时（超过 360 秒），已坚决终止发表！', null, 'error', { persistent: true });
          return { success: false, platform: 'wechat', message: this.formatLog('微信视频上传等待超时（>360s），已终止发表', activeLang) };
        }
        // ────────────────────────────────────────────────────────────────────────────

        // ── 点击发表前表单健康与错误提示检查 ──────────────────────────────────────
        const preCheck = await client.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : '';
          const hasErrorText =
            bodyText.includes('请修改错误') ||
            bodyText.includes('标题超过16字') ||
            bodyText.includes('敏感词') ||
            bodyText.includes('请设置封面') ||
            bodyText.includes('请先上传封面');

          const warnNodes = Array.from(
            document.querySelectorAll('.weui-desktop-form__tips_warn, .weui-desktop-msg__desc, [class*="error-text"]')
          ) as HTMLElement[];
          const visibleWarn = warnNodes.find((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetHeight > 0 && !(el.textContent || '').includes('成功');
          });

          return {
            hasError: Boolean(hasErrorText || visibleWarn),
            errorMsg: visibleWarn ? (visibleWarn.textContent || '').trim() : (hasErrorText ? '表单存在未通过项' : ''),
          };
        }).catch(() => null);

        if (preCheck?.hasError) {
          await tracer.updateStep(5, 'error');
          await tracer.track(`❌ [发表前检查] 检测到微信表单存在错误提示: ${preCheck.errorMsg || '请核对表单信息'}，已终止发表！`, null, 'error', { persistent: true });
          return {
            success: false,
            platform: 'wechat',
            message: `微信表单存在未通过项: ${preCheck.errorMsg || '请检查标题字数与封面'}`,
          };
        }

        await tracer.track('所有校验与交互就绪，正在精准锁定并自动点击【发表】按钮...');
        try {
          // 1. 等待【发表】按钮处于可交互状态（非禁用、非加载中），最多等待 10 秒
          let pubBtnReady = false;
          let pubBtnInfo: any = null;

          for (let waitReady = 0; waitReady < 10; waitReady++) {
            if (signal.aborted || adapter.isClosed() || tracer.isAborted()) {
              throw new PublishAbortedError(this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }), activeLang);
            }

            pubBtnInfo = await client.evaluate(() => {
              const getRoots = () => {
                const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
                for (const f of Array.from(document.querySelectorAll('iframe'))) {
                  try {
                    if (f.contentDocument) {
                      const r = f.getBoundingClientRect();
                      roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                    }
                  } catch { }
                }
                return roots;
              };

              const isPublishButtonText = (t: string) => {
                if (!t) return false;
                const s = t.trim().toLowerCase();
                return s === '发表' || s === '定时发表' || s === 'publish' || s === 'post' || s === 'schedule publish' || s === 'schedule post';
              };

              const roots = getRoots();
              for (const { doc, offsetX, offsetY } of roots) {
                const allBtns = Array.from(doc.querySelectorAll('button, .weui-desktop-btn')) as HTMLElement[];
                const pubBtn = allBtns.find(b => {
                  const txt = (b.textContent || '').trim();
                  return isPublishButtonText(txt) && (b.classList.contains('weui-desktop-btn_primary') || b.closest('.weui-desktop-btn_wrp'));
                }) || allBtns.find(b => {
                  const txt = (b.textContent || '').trim();
                  return isPublishButtonText(txt);
                });

                if (!pubBtn) continue;

                const isDisabled =
                  pubBtn.getAttribute('disabled') !== null ||
                  pubBtn.classList.contains('weui-desktop-btn_disabled') ||
                  pubBtn.classList.contains('is-disabled') ||
                  pubBtn.classList.contains('weui-desktop-btn_loading') ||
                  pubBtn.getAttribute('aria-disabled') === 'true';

                pubBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
                const r = pubBtn.getBoundingClientRect();
                return {
                  found: true,
                  disabled: isDisabled,
                  text: (pubBtn.textContent || '').trim(),
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                  width: r.width,
                  height: r.height,
                };
              }
              return { found: false, disabled: true };
            });

            if (pubBtnInfo?.found && !pubBtnInfo?.disabled && pubBtnInfo?.x && pubBtnInfo?.y) {
              pubBtnReady = true;
              break;
            }

            if (pubBtnInfo?.found && pubBtnInfo?.disabled) {
              await tracer.track(`⏳ 【发表】按钮当前处于禁用或加载状态，等待按钮就绪 (${waitReady + 1}/10s)...`);
            }
            await sleep(1000, signal);
          }

          if (!pubBtnInfo?.found) {
            await tracer.updateStep(5, 'error');
            await tracer.track('❌ 未能定位到微信视频号【发表】按钮，无法自动发表！', null, 'error', { persistent: true });
            return {
              success: false,
              platform: 'wechat',
              message: this.formatLog('未能定位到微信视频号【发表】按钮，发表未完成', activeLang),
            };
          }

          // 2. 触发点击：采用 CDP 硬件级拟人点击 + DOM click() 双重保险触发
          await tracer.track(`[最终发表] 正在向【发表】按钮发起硬件级拟人轨迹物理点击 (坐标: ${pubBtnInfo.x}, ${pubBtnInfo.y})...`);
          await client.mouseClick(pubBtnInfo.x, pubBtnInfo.y, { delayMs: 120 });

          // DOM 双重保底派发
          await client.evaluate(() => {
            const isPublishButtonText = (t: string) => {
              if (!t) return false;
              const s = t.trim().toLowerCase();
              return s === '发表' || s === '定时发表' || s === 'publish' || s === 'post' || s === 'schedule publish' || s === 'schedule post';
            };
            const btns = Array.from(document.querySelectorAll('button, .weui-desktop-btn')) as HTMLElement[];
            const pubBtn = btns.find(b => isPublishButtonText((b.textContent || '').trim()));
            if (pubBtn) {
              try { pubBtn.focus(); } catch { }
              try { pubBtn.click(); } catch { }
              try { pubBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch { }
            }
          }).catch(() => { });

          await sleep(1000, signal);

          // 3. 严谨校验微信发表后的反馈状态（循环 18 秒：实时处理弹窗、排查错误、检测成功状态）
          let publishConfirmed = false;
          let wechatErrorMessage = '';
          let hasRetriedWechatClick = false;
          let lastPageDiagnosis = '';

          for (let waitSec = 0; waitSec < 18; waitSec++) {
            await sleep(1000, signal);
            if (signal.aborted || adapter.isClosed() || tracer.isAborted()) {
              throw new PublishAbortedError(this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }), activeLang);
            }

            // ── 检查并处理可能的二次确认弹窗（例如“未声明原创是否直接发表”、“确认发表”等） ──
            const dialogAction = await client.evaluate(() => {
              const getRoots = () => {
                const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
                for (const f of Array.from(document.querySelectorAll('iframe'))) {
                  try {
                    if (f.contentDocument) {
                      const r = f.getBoundingClientRect();
                      roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
                    }
                  } catch { }
                }
                return roots;
              };

              const confirmKeywords = [
                '直接发表',
                '仍要发表',
                '继续发表',
                '确认发表',
                '立即发表',
                '确定发表',
                '确定',
                '确认',
                '我知道了',
                '我知道',
                '继续',
                '提交',
                '允许',
              ];

              const roots = getRoots();
              for (const { doc, offsetX, offsetY } of roots) {
                const dialogs = Array.from(doc.querySelectorAll('.weui-desktop-dialog, .weui-desktop-dialog__wrp, .weui-desktop-modal, [role="dialog"]')) as HTMLElement[];
                const visibleDialog = dialogs.find(d => {
                  const s = window.getComputedStyle(d);
                  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && d.offsetHeight > 0;
                });

                if (visibleDialog) {
                  const dialogText = (visibleDialog.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
                  const btns = Array.from(visibleDialog.querySelectorAll('button, .weui-desktop-btn, [role="button"], a')) as HTMLElement[];
                  const confirmBtn = btns.find(b => {
                    const txt = (b.textContent || '').trim();
                    return confirmKeywords.some(kw => txt === kw || txt.includes(kw));
                  });

                  if (confirmBtn) {
                    confirmBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
                    const r = confirmBtn.getBoundingClientRect();
                    try { confirmBtn.focus(); } catch { }
                    try { confirmBtn.click(); } catch { }
                    return {
                      detected: true,
                      dialogText,
                      btnText: (confirmBtn.textContent || '').trim(),
                      x: Math.round(r.left + offsetX + r.width / 2),
                      y: Math.round(r.top + offsetY + r.height / 2),
                    };
                  }
                  return { detected: true, dialogText, btnText: null, x: null, y: null };
                }
              }
              return null;
            }).catch(() => null);

            if (dialogAction?.detected && dialogAction?.btnText) {
              await tracer.track(`[二次确认] 发现弹窗提示: "${dialogAction.dialogText}"，已自动确认点击【${dialogAction.btnText}】`);
              if (dialogAction.x && dialogAction.y) {
                await client.mouseClick(dialogAction.x, dialogAction.y, { delayMs: 100 });
              }
              await sleep(1000, signal);
            }

            // ── 深度状态检测 ──
            const postResult = await client.evaluate(() => {
              const curUrl = location.href;
              const bodyText = document.body ? document.body.innerText : '';

              // 1. 深度检测微信 DOM 中的报错/警告元素
              const errorSelectors = [
                '.weui-desktop-form__tips_warn',
                '.weui-desktop-msg__desc',
                '.weui-desktop-toast_warn',
                '.weui-desktop-form__error',
                '.ant-form-item-explain-error',
                '[class*="error-text"]',
                '[class*="warn-text"]',
                '[class*="input-error"]',
              ];
              const errorNodes = Array.from(document.querySelectorAll(errorSelectors.join(', '))) as HTMLElement[];
              const visibleErrorTexts = errorNodes
                .filter((el) => {
                  const style = window.getComputedStyle(el);
                  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetHeight > 0;
                })
                .map((el) => (el.textContent || '').trim())
                .filter((t) => t.length > 0 && !t.includes('成功'));

              // 2. 关键词匹配微信常见校验拦截与异常
              const errorKeywords = [
                '请修改错误',
                '标题超过',
                '字数超过',
                '不能超过',
                '发布失败',
                '发表失败',
                '敏感词',
                '违规',
                '系统繁忙',
                '操作过于频繁',
                '请先上传封面',
                '请设置封面',
                '请完善信息',
                '内容不合规',
                '账号异常',
                '已被限制',
                '视频格式错误',
                '未选择封面',
              ];

              let matchedKeyword = '';
              for (const kw of errorKeywords) {
                if (bodyText.includes(kw)) {
                  matchedKeyword = kw;
                  break;
                }
              }

              const hasError = visibleErrorTexts.length > 0 || Boolean(matchedKeyword);
              const errorDetail = visibleErrorTexts.length > 0
                ? visibleErrorTexts.join('；')
                : (matchedKeyword ? `检测到异常提示: ${matchedKeyword}` : '');

              // 3. 页面离开创建页或成功跳转
              const isLeftCreatePage =
                !curUrl.includes('/post/create') ||
                curUrl.includes('/post/list') ||
                curUrl.includes('/post/manage') ||
                curUrl.includes('/dashboard') ||
                curUrl.includes('/channels/finder');

              // 4. 成功状态与成功文案全面匹配
              const hasSuccessToast =
                bodyText.includes('发表成功') ||
                bodyText.includes('发布成功') ||
                bodyText.includes('定时发表成功') ||
                bodyText.includes('定时发布成功') ||
                bodyText.includes('已定时发表') ||
                bodyText.includes('动态已发表') ||
                bodyText.includes('视频发表成功') ||
                bodyText.includes('创建成功') ||
                bodyText.includes('提交成功') ||
                bodyText.includes('已提交审核') ||
                bodyText.includes('提交审核成功') ||
                bodyText.includes('视频已提交') ||
                bodyText.includes('动态已提交') ||
                bodyText.includes('作品已提交') ||
                bodyText.includes('已成功发表') ||
                bodyText.includes('内容已提交') ||
                bodyText.includes('发表完成') ||
                bodyText.includes('发布完成') ||
                bodyText.includes('再发一条') ||
                bodyText.includes('查看动态') ||
                Boolean(document.querySelector('.weui-desktop-icon-toast_success, [class*="toast-success"]'));

              // 检查发表按钮是否正在 loading 或禁用
              const pubBtn = document.querySelector('button.weui-desktop-btn_primary, .weui-desktop-btn_wrp button') as HTMLElement | null;
              const isBtnLoading = Boolean(pubBtn && (pubBtn.classList.contains('weui-desktop-btn_loading') || pubBtn.getAttribute('disabled') !== null));

              return {
                isLeftCreatePage,
                hasSuccessToast,
                hasError,
                errorDetail,
                isBtnLoading,
                curUrl,
                btnText: pubBtn ? (pubBtn.textContent || '').trim() : '',
              };
            }).catch(() => null);

            // 一旦检测到任何明确的表单报错信息，立即终止并判定失败
            if (postResult?.hasError) {
              wechatErrorMessage = postResult.errorDetail || '微信页面检测到表单或提交异常提示';
              await tracer.track(`❌ 微信发表遇到异常提示: ${wechatErrorMessage}`, null, 'error', { persistent: true });
              publishConfirmed = false;
              break;
            }

            if ((postResult?.isLeftCreatePage || postResult?.hasSuccessToast) && !postResult?.hasError) {
              publishConfirmed = true;
              break;
            }

            if (postResult?.isBtnLoading) {
              await tracer.track('⏳ 微信正在提交视频素材与发表数据中...', null, 'info');
            }

            // 如果经过 5 秒仍未成功且无 loading，进行一次补充点击重试（物理 + DOM）
            if (waitSec === 5 && !postResult?.isBtnLoading && !hasRetriedWechatClick && pubBtnInfo.x && pubBtnInfo.y) {
              hasRetriedWechatClick = true;
              await tracer.track('ℹ️ 正在补充触发一次微信【发表】按钮点击确认...');
              await client.mouseClick(pubBtnInfo.x, pubBtnInfo.y, { delayMs: 150 });
              await client.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, .weui-desktop-btn')) as HTMLElement[];
                const btn = btns.find(b => ['发表', '定时发表'].includes((b.textContent || '').trim()));
                if (btn) {
                  try { btn.focus(); } catch { }
                  try { btn.click(); } catch { }
                }
              }).catch(() => { });
            }

            lastPageDiagnosis = `URL: ${postResult?.curUrl || '未知'}, 按钮文案: ${postResult?.btnText || '无'}, Loading: ${postResult?.isBtnLoading}`;
          }

          // 只有明确检测到成功提示或页面跳转，且没有任何异常错误提示时，才认定发布成功
          if (publishConfirmed && !wechatErrorMessage) {
            await tracer.updateStep(5, 'done');
            await tracer.track(this.t('publishSuccessDetected', activeLang, { platform: this.getDisplayName(activeLang) }), null, 'success');
            return {
              success: true,
              platform: 'wechat',
              message: this.t('publishSuccess', activeLang, { platform: this.getDisplayName(activeLang) }),
            };
          } else {
            await tracer.updateStep(5, 'error');
            const finalMsg = wechatErrorMessage || this.t('publishTimeout', activeLang);
            await tracer.track(`⚠️ ${finalMsg}`, null, 'warn', { persistent: true });
            return {
              success: false,
              platform: 'wechat',
              message: finalMsg,
            };
          }
        } catch (err: any) {
          if (err instanceof PublishAbortedError || err?.isAborted || signal.aborted || adapter.isClosed() || tracer.isAborted()) {
            throw err;
          }
          await tracer.track(`Publish action error: ${err.message}`, err.stack, 'warn');
          return {
            success: false,
            platform: 'wechat',
            message: this.t('publishFailed', activeLang, { platform: this.getDisplayName(activeLang), error: err.message }),
          };
        }
      }

      if (signal.aborted || adapter.isClosed() || tracer.isAborted()) {
        throw new PublishAbortedError(this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }));
      }

      await tracer.track('⚠️ Form filled, awaiting manual publish click', null, 'warn');
      return {
        success: false,
        platform: 'wechat',
        message: 'Form filled, awaiting manual confirmation',
      };
    } catch (err: any) {
      if (err?.isAborted || err?.name === 'PublishAbortedError' || signal.aborted || adapter.isClosed()) {
        console.warn(`[ShortVideo ${this.getDisplayName()}] Aborted: ${err.message}`);
        return {
          success: false,
          platform: 'wechat',
          message: err.message || this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }),
        };
      }
      throw err;
    } finally {
      if (this.currentAbortController?.signal === signal) {
        this.currentAbortController = null;
      }
      if (client) {
        try { client.close(); } catch { }
      }
    }
  }
}

