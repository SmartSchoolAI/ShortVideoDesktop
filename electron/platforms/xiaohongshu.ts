import { WebContents } from 'electron';
import fs from 'fs';
import { BasePlatform, PublishPayload, PlatformPublishResult, PublishAbortedError } from './base-platform';
import { PlatformTabAdapter } from '../services/window-manager';
import { CdpPageClient } from '../services/cdp-bridge';
import { sleep, simulateClipboardHesitation, waitHumanInterval } from '../utils/human-simulator';
import { ActionTracer } from '../utils/action-tracer';
import { XIAOHONGSHU_PUBLISH_STEPS, getPlatformPublishSteps } from '../utils/step-bar';
import { tPlatform, getPlatformDisplayName } from './platform-i18n';

export class XiaohongshuPlatform extends BasePlatform {
  readonly platformId = 'xiaohongshu';
  get name(): string {
    return getPlatformDisplayName('xiaohongshu');
  }
  readonly homeUrl = 'https://creator.xiaohongshu.com/new/home?source=official';
  readonly publishUrl = 'https://creator.xiaohongshu.com/publish/publish?source=official';

  /**
   * 检查是否已登录小红书创作者服务平台（严格防未登录误判）
   */
  async checkLoginStatus(webContents: WebContents): Promise<boolean> {
    if (!webContents || webContents.isDestroyed()) return false;
    const currentUrl = webContents.getURL() || '';
    if (currentUrl.includes('/login')) {
      return false;
    }

    try {
      // 1. DOM 严格核验：优先一票否决未登录特征（二维码、登录卡片、弹窗遮罩等）
      const domResult = await webContents.executeJavaScript(`
        (() => {
          const url = window.location.href;
          if (url.includes('/login')) return { isLogin: false, reason: 'login-url' };

          const text = document.body ? (document.body.innerText || '') : '';

          // 核心一票否决 A：页面存在登录专属扫码二维码
          const isLoginQr = (el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 50 || r.height < 50) return false;
            const inLoginBox = Boolean(
              el.closest('.login-box, .login-container, [class*="login-box"], [class*="login-container"], .login-modal, .login-wrapper')
            );
            const isQrClass = el.matches('[class*="qrcode-img"], [class*="qrcode_img"], [class*="qrcode"] img, .qrcode-img');
            return inLoginBox || isQrClass;
          };

          const qrEls = Array.from(document.querySelectorAll(
            '.login-container canvas, .login-box canvas, [class*="login"] canvas, img[src*="qr"], [class*="qrcode-img"], [class*="qrcode_img"], [class*="qrcode"] img, [class*="qrcode"]'
          ));
          const hasVisibleQr = qrEls.some(isLoginQr);
          if (hasVisibleQr) return { isLogin: false, reason: 'visible-qrcode' };

          // 核心一票否决 B：页面包含未登录文本卡片
          const hasLoginText = 
            (text.includes('加入我们') && text.includes('解锁创作者专属功能')) || 
            text.includes('短信登录') || 
            text.includes('小红书 App 扫码登录') ||
            text.includes('微信扫码登录') ||
            text.includes('登录即可体验');
          if (hasLoginText) return { isLogin: false, reason: 'login-card-text' };

          // 核心一票否决 C：页面存在登录弹窗遮罩
          const hasLoginBox = Boolean(
            document.querySelector('.login-box, .login-container, [class*="login-box"], [class*="login-container"], .login-modal')
          );
          if (hasLoginBox) return { isLogin: false, reason: 'login-box' };

          // 正向凭证：检查真实创作者信息（头像、昵称、已登录侧边栏）
          const hasUserAvatar = Boolean(
            document.querySelector('.user-avatar, .creator-header .avatar, [class*="avatar"] img, img.avatar')
          );
          const hasUserName = Boolean(
            document.querySelector('.user-name, .creator-name, .author-name, .user-nickname')
          );
          const hasCreatorNav = Boolean(
            document.querySelector('.creator-sidebar') ||
            document.querySelector('a[href*="/publish"]') ||
            document.querySelector('a[href*="/post"]') ||
            document.querySelector('.post-btn')
          );

          const hasUserInfo = hasUserAvatar || hasUserName || hasCreatorNav;
          return { isLogin: hasUserInfo, hasUserInfo };
        })()
      `).catch(() => null);

      if (domResult && domResult.isLogin) {
        return true;
      }

      // 2. 备用凭证：严格核验真正的创作者鉴权 Session Cookie（严禁把 customerclientid 当登录凭证！）
      const cookies = await webContents.session.cookies.get({ domain: '.xiaohongshu.com' }).catch(() => []);
      const hasStrictSession = cookies.some((c) => {
        const n = c.name.toLowerCase();
        return (n === 'web_session' || n === 'galaxy_creator_session_id' || n === 'creator_session') &&
          Boolean(c.value && c.value.length > 10);
      });

      // 只有在明确无任何未登录特征且拥有有效 session 时才判定为已登录
      if (hasStrictSession && domResult && !domResult.reason) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * 自动将小红书登录卡片切换为【二维码扫码登录】
   * 彻底解决短信验证码因风控导致“请稍候...”卡死的问题
   */
  async ensureQrcodeMode(webContents: WebContents): Promise<boolean> {
    if (!webContents || webContents.isDestroyed()) return false;
    try {
      const switchCoord: any = await webContents.executeJavaScript(`
        (() => {
          // 1. 若当前已呈现二维码则无需重复切换
          const hasQr = Boolean(
            document.querySelector('canvas, img[src*="qr"], [class*="qrcode-img"], [class*="qrcode_img"], [class*="qrcode"] img')
          );
          if (hasQr) return false;

          // 2. 优先通过类名或属性查找右上角切换角标
          const allEl = Array.from(document.querySelectorAll('*')) as HTMLElement[];
          const switchEl = allEl.find((el) => {
            if (el.children.length > 2) return false;
            const cls = (el.className || '').toString().toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            return (
              cls.includes('qrcode') ||
              cls.includes('toggle') ||
              cls.includes('switch') ||
              title.includes('扫码') ||
              title.includes('二维码') ||
              aria.includes('扫码')
            ) && el.offsetParent !== null;
          });

          if (switchEl) {
            const r = switchEl.getBoundingClientRect();
            return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          }

          // 3. 几何坐标兜底：定位短信登录卡片，点击其右上角折角切换区域
          const loginTitleEl = allEl.find((el) => (el.textContent || '').trim() === '短信登录' && el.children.length === 0);
          if (loginTitleEl) {
            const card = loginTitleEl.closest('div, form') || loginTitleEl.parentElement?.parentElement;
            if (card) {
              const cardRect = card.getBoundingClientRect();
              const corners = Array.from(card.querySelectorAll('*')).filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width >= 12 && r.height >= 12 && r.top <= cardRect.top + 70 && r.right >= cardRect.right - 70;
              }) as HTMLElement[];
              if (corners.length > 0) {
                const corner = corners[corners.length - 1];
                const r = corner.getBoundingClientRect();
                return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              }
            }
          }
          return { found: false };
        })()
      `).catch(() => ({ found: false }));

      if (switchCoord && switchCoord.found && switchCoord.x && switchCoord.y) {
        const { simulateHumanClick } = await import('../utils/human-simulator');
        await simulateHumanClick(webContents, switchCoord.x, switchCoord.y);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 监听等待用户扫码登录小红书（未登录时坚决停留等待，绝不抢跑）
   */
  async waitForLogin(
    webContents: WebContents,
    tracer: ActionTracer,
    timeoutMs = 300000,
    signal?: AbortSignal
  ): Promise<boolean> {
    const startTime = Date.now();
    const platformName = this.getDisplayName();
    await tracer.track(tPlatform('switchedToQrMode'), null, 'warn', { persistent: true });

    // 初始立即尝试切换为二维码扫码模式
    await this.ensureQrcodeMode(webContents);

    let lastLogTime = 0;
    while (Date.now() - startTime < timeoutMs) {
      if (signal?.aborted || webContents.isDestroyed()) return false;
      const loggedIn = await this.checkLoginStatus(webContents);
      if (loggedIn) {
        await tracer.track(tPlatform('loginSuccess', undefined, { platform: platformName }), null, 'success');
        return true;
      }

      // 周期性确保二维码保持呈现（防止页面刷新后又退回短信登录）
      await this.ensureQrcodeMode(webContents);

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
   * 登录成功后，在创作者中心主页拟人化寻找并点击“新建视频/发布笔记”入口
   * 严格遵守规则：不要一开始就是发布视频页面，必须先判断登录，已登录后再点击新建视频页面
   */
  async navigateToNewPostPage(client: CdpPageClient, tracer: ActionTracer, adapter?: PlatformTabAdapter): Promise<boolean> {
    await tracer.track(tPlatform('findingPublishEntry', undefined, { btn: '发布笔记/新建视频' }));

    // 模拟人工浏览审视主页 1.5 ~ 2.5 秒
    await waitHumanInterval(tracer, 1500, 2500, 'Reviewing creator home');

    for (let attempt = 0; attempt < 3; attempt++) {
      const clickResult = await client.evaluate(() => {
        const curUrl = location.href;
        if (curUrl.includes('/publish')) {
          return { alreadyInPublish: true };
        }

        const allElements = Array.from(document.querySelectorAll('a, button, div, span, li, p')) as HTMLElement[];

        // 策略 1: 寻找链接 href 包含 /publish 的导航元素
        const publishLinks = allElements.filter((el) => {
          const href = (el.getAttribute('href') || '').toLowerCase();
          return href.includes('/publish') || href.includes('source=publish');
        });
        if (publishLinks.length > 0) {
          const target: any = publishLinks[0];
          target.scrollIntoView({ behavior: 'auto', block: 'center' });
          const r = target.getBoundingClientRect();
          return { success: true, text: (target.textContent || '').trim() || '发布笔记链接', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }

        // 策略 2: 寻找文本包含“发布笔记”或“发布视频”的按钮
        const publishButtons = allElements.filter((el) => {
          if (el.children.length > 2) return false;
          const txt = (el.textContent || '').trim();
          return ['发布笔记', '发布视频', '新建发布', '发笔记'].includes(txt);
        });

        if (publishButtons.length > 0) {
          const target: any = publishButtons[0];
          target.scrollIntoView({ behavior: 'auto', block: 'center' });
          const r = target.getBoundingClientRect();
          return { success: true, text: (target.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        }

        return { success: false, reason: '未找到发布入口元素' };
      }).catch(() => ({ success: false, reason: '页面可能正在跳转' }));

      if (clickResult.alreadyInPublish) {
        await tracer.track(tPlatform('alreadyOnPublishPage'), null, 'success');
        return true;
      }

      if (clickResult.success && (clickResult as any).x && (clickResult as any).y) {
        await client.mouseClick((clickResult as any).x, (clickResult as any).y);
      }

      if (clickResult.success && adapter) {
        await tracer.track(tPlatform('clickedPublishEntry', undefined, { btn: clickResult.text }), null, 'success');
        // 关键断言：循环等待 URL 真正变更为包含 /publish 的发布页面，并核验是否真正渲染出了发布组件
        for (let i = 0; i < 6; i++) {
          await sleep(500);
          const nowUrl = adapter.webContents.getURL();
          if (nowUrl.includes('/publish') && !nowUrl.includes('/new/home')) {
            const hasPublishComponent = await client.evaluate(() => {
              const text = document.body ? document.body.innerText || '' : '';
              const hasUploadInput = Boolean(document.querySelector('input[type="file"], .upload-container, .upload-content, .uploader, [class*="upload"]'));
              return hasUploadInput || text.includes('拖拽视频到此处') || text.includes('点击上传') || text.includes('视频大小');
            }).catch(() => false);

            if (hasPublishComponent) {
              await tracer.track(tPlatform('enteredPublishPageSuccess'), null, 'success');
              return true;
            }
          }
        }
      }

      await sleep(1000);
    }

    // 强力确定性保障：若主页拟人化点击未能促成发布页面渲染，直接导航至发布页确保 100% 进入！
    if (adapter) {
      await tracer.track(tPlatform('fallbackDirectNav'), null, 'info');
      await adapter.loadURL(this.publishUrl);
      await sleep(2500);
      while (adapter.webContents.isLoading()) {
        await sleep(500);
      }
      await sleep(1000);
    }
    return true;
  }

  async dismissDialogs(client: CdpPageClient, tracer: ActionTracer): Promise<void> {
    // 多轮扫描，确保弹窗链（A 弹窗关闭后触发 B 弹窗）也能被处理
    for (let round = 0; round < 5; round++) {
      try {
        const result = await client.evaluate(() => {
          // 统一所有确认类文案关键词
          const confirmKeywords = [
            '我知道了', '知道了', '确定', '同意', '好的', '好',
            '关闭', '跳过', '以后再说', '下次再说', '不了', '取消',
          ];

          // 所有可能是遮罩弹窗的容器选择器
          const dialogSelectors = [
            '.d-dialog', '.el-dialog', '[role="dialog"]',
            '.d-modal', '.modal-mask', '[class*="dialog"]',
            '[class*="modal"]', '[class*="popup"]', '[class*="guide"]',
            '[class*="toast"]', '[class*="overlay"]',
          ];

          // 先在弹窗容器内寻找确认按钮
          for (const sel of dialogSelectors) {
            const dialogs = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
            for (const dialog of dialogs) {
              if (dialog.offsetParent === null) continue;
              const btns = (Array.from(dialog.querySelectorAll('button, [class*="btn"], [class*="button"], div, span')) as HTMLElement[])
                .filter((b) => b.offsetParent !== null && (b.textContent || '').trim().length > 0 && (b.textContent || '').trim().length < 20);
              const btn: any = btns.find((b) => {
                const txt = (b.textContent || '').trim();
                return confirmKeywords.some((kw) => txt.includes(kw));
              });
              if (btn) {
                btn.scrollIntoView({ behavior: 'auto', block: 'center' });
                const r = btn.getBoundingClientRect();
                return { clicked: true, text: (btn.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
              }
            }
          }

          // 全页面兜底：查找任何可见的确认按钮（限制在小型按钮文案范围内防误触）
          const allBtns = (Array.from(document.querySelectorAll('button')) as HTMLButtonElement[])
            .filter((b) => b.offsetParent !== null);
          const fallbackBtn: any = allBtns.find((b) => {
            const txt = (b.textContent || '').trim();
            return confirmKeywords.some((kw) => txt === kw);
          });
          if (fallbackBtn) {
            fallbackBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
            const r = fallbackBtn.getBoundingClientRect();
            return { clicked: true, text: (fallbackBtn.textContent || '').trim(), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          }

          return { clicked: false };
        }).catch(() => ({ clicked: false }));

        if (result.clicked && (result as any).x && (result as any).y) {
          await client.mouseClick((result as any).x, (result as any).y);
          await tracer.track(tPlatform('dismissedDialog', undefined, { btn: result.text }));
          await sleep(700);
          // 继续下一轮，确认是否有新弹窗
        } else {
          break; // 无弹窗，退出扫描
        }
      } catch {
        break;
      }
    }
  }

  /**
   * 严格等待小红书发布页面渲染就绪（确保脱离白屏且确属发布页面）
   */
  async waitForPublishPageReady(
    client: CdpPageClient,
    tracer: ActionTracer,
    timeoutMs = 35000,
    signal?: AbortSignal,
    adapter?: PlatformTabAdapter
  ): Promise<boolean> {
    const effectiveSignal = signal || tracer.getSignal();
    const startTime = Date.now();
    const platformName = this.getDisplayName();
    await tracer.track(tPlatform('waitingPageReady', undefined, { platform: platformName }), null, 'info', { persistent: true });

    let healed = false;
    while (Date.now() - startTime < timeoutMs) {
      if (effectiveSignal?.aborted || tracer.isAborted() || client.isClosedNow()) {
        throw new PublishAbortedError(tPlatform('tabClosed', undefined, { platform: platformName }));
      }

      const pageInfo = await client.evaluate(() => {
        const body = document.body;
        if (!body) return { isReady: false };
        const url = location.href;
        // 核心防误判校验：当前 URL 必须明确包含 /publish，绝不能在主页误判为就绪！
        if (!url.includes('/publish') || url.includes('/new/home')) {
          return { isReady: false, reason: '当前非发布页面 (' + url + ')' };
        }

        const readyState = document.readyState;
        const text = body.innerText || '';

        // 强力排除首页特征：若页面包含首页专属的分析或所有按钮均仅为“发布笔记”且无上传容器，一票否决
        const isHomePageStill =
          text.includes('数据概览') ||
          text.includes('创作者灵感') ||
          text.includes('粉丝总数') ||
          (Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter((t) => t === '发布笔记').length >= 2 && !document.querySelector('input[type="file"]'));

        if (isHomePageStill) {
          return { isReady: false, reason: '页面仍然呈现首页特征' };
        }

        // 必须出现实际的视频素材上传区域或文件选择器或发布模式卡片
        const hasFileInput = Boolean(document.querySelector('input[type="file"], input[accept*="video"]'));
        const hasUploadBox = Boolean(document.querySelector('.upload-container, .upload-content, .uploader, [class*="upload-wrapper"], [class*="uploader"]'));
        const hasUploadText = text.includes('拖拽视频到此处') || text.includes('点击上传') || text.includes('支持常用视频格式') || text.includes('上传视频并发布');
        const hasPublishTabs = (text.includes('上传视频') || text.includes('视频笔记')) && (text.includes('上传图文') || text.includes('图文笔记'));

        const hasUpload = hasFileInput || hasUploadBox || hasUploadText || hasPublishTabs;
        const hasInputs = Array.from(document.querySelectorAll('input')).some((i) => i.offsetParent !== null && i.type !== 'hidden');

        const isReady = (readyState === 'complete' || readyState === 'interactive') && hasUpload;

        return {
          isReady,
          hasUpload,
          hasInputs,
        };
      }).catch((err: any) => {
        if (effectiveSignal?.aborted || tracer.isAborted() || client.isClosedNow()) {
          throw new PublishAbortedError(tPlatform('tabClosed', undefined, { platform: platformName }));
        }
        return null;
      });

      if (pageInfo && pageInfo.isReady) {
        await tracer.track(tPlatform('pageReadySuccess', undefined, { platform: platformName }), pageInfo, 'success');
        return true;
      }

      // 自愈保护：若超过 4 秒仍未处于真实发布页，且持有 adapter，主动触发一次直接导航
      if (!healed && adapter && Date.now() - startTime > 4000) {
        healed = true;
        await tracer.track(tPlatform('fallbackDirectNav'), null, 'info');
        await adapter.loadURL(this.publishUrl).catch(() => {});
        await sleep(2500, effectiveSignal);
        while (adapter.webContents.isLoading()) {
          await sleep(500, effectiveSignal);
        }
        await sleep(1000, effectiveSignal);
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed > 0 && elapsed % 3 === 0) {
        await tracer.track(tPlatform('waitingPageReadyTick', undefined, { platform: platformName, elapsed }), null, 'info', { persistent: true });
      }

      await sleep(1000, effectiveSignal);
    }

    await tracer.track(tPlatform('pageReadyTimeout'), null, 'warn');
    return false;
  }

  async uploadVideoViaCdp(client: CdpPageClient, filePath: string, tracer: ActionTracer): Promise<boolean> {
    await tracer.track(tPlatform('preparingCdpUpload'), { path: filePath });

    // 开启文件选择器拦截，彻底杜绝操作系统弹窗
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
        // A. 尝试直接通过 CDP 注入 input[type="file"]
        try {
          const ok = await client.setInputFiles('input[type="file"]', filePath);
          if (ok) {
            await tracer.track(tPlatform('uploadSuccess', undefined, { attempt: attempt + 1 }), null, 'success');
            return true;
          }
        } catch (e: any) {
          await tracer.track(tPlatform('uploadAttemptFailed', undefined, { attempt: attempt + 1, error: e.message }), null, 'warn');
        }

        // B. 点击上传区域唤起文件选择器 (通过 CDP 硬件物理点击)
        await client.clickSelector('.upload-container, .upload-content, .uploader, [class*="upload"]', 2000).catch(() => { });

        await new Promise((r) => setTimeout(r, 1000));

        // C. 检查无感拦截的文件选择器
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

      return false;
    } finally {
      client.off('Page.fileChooserOpened', fileChooserHandler);
      try {
        await client.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false });
      } catch { }
    }
  }

  /**
   * 严格等待小红书解析视频并呈现笔记编辑表单
   */
  async waitForEditFormReady(
    client: CdpPageClient,
    tracer: ActionTracer,
    timeoutMs = 30000
  ): Promise<boolean> {
    const startTime = Date.now();
    const platformName = this.getDisplayName();
    await tracer.track(tPlatform('waitingFormReady', undefined, { platform: platformName }), null, 'info', { persistent: true });

    while (Date.now() - startTime < timeoutMs) {
      const isReady = await client.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input')).filter((i) => (i as any).offsetParent !== null && i.type !== 'file');
        const editors = Array.from(document.querySelectorAll('[contenteditable], textarea, #post-textarea')).filter((e) => (e as any).offsetParent !== null);
        return inputs.length > 0 && editors.length > 0;
      }).catch(() => false);

      if (isReady) {
        await tracer.track('✅ 小红书发布表单已加载就绪！', null, 'success');
        return true;
      }
      await sleep(1000);
    }
    return false;
  }

  /**
   * 检查并配置小红书发布高级选项（原创声明、AI创作声明、定时发布等）
   */
  async configurePublishOptions(client: CdpPageClient, tracer: ActionTracer, payload?: PublishPayload): Promise<void> {
    await tracer.track('⚙️ 开始检查并配置小红书高级发布选项 (原创声明 / AI创作声明 / 定时发布)...');

    // 1. 全容器平滑滚动到底部，确保延迟加载的设置组件完整呈现在视口中
    await client.evaluate(() => {
      try { window.scrollTo({ top: document.body?.scrollHeight || 99999, behavior: 'auto' }); } catch { }
      try { document.documentElement?.scrollTo({ top: 99999, behavior: 'auto' }); } catch { }
      try {
        const all = Array.from(document.querySelectorAll('*'));
        for (const el of all) {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
            el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
          }
        }
      } catch { }
    });
    await sleep(800);

    // 2. 检查是否有折叠的“高级设置”或“更多设置”并通过物理鼠标展开
    const expandCoord = await client.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button, div, span, a')) as HTMLElement[];
      const expandBtn: any = allButtons.find((el) => {
        const txt = (el.textContent || '').trim();
        const isExpand = (txt.includes('高级设置') || txt.includes('更多设置') || txt.includes('其他设置') || txt.includes('展开')) && !txt.includes('收起');
        return isExpand && el.children.length <= 2 && el.offsetParent !== null;
      });
      if (expandBtn) {
        expandBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
        const r = expandBtn.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
      return null;
    }).catch(() => null);

    if (expandCoord && expandCoord.x && expandCoord.y) {
      await client.mouseClick(expandCoord.x, expandCoord.y);
    }
    await sleep(600);

    // 3. 处理【原创声明】
    await tracer.track('正在检查并处理【原创声明】...');
    let origConfigured = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      // 深度定位原创声明区域（优先使用小红书官方类名 .original-wrapper / .custom-switch-card）
      const origLocation = await client.evaluate(() => {
        // 策略 1: 小红书专属容器选择器 .original-wrapper 或 .custom-switch-card
        let wrapper = document.querySelector('.original-wrapper') as HTMLElement | null;
        if (!wrapper) {
          const cards = Array.from(document.querySelectorAll('.custom-switch-card, .custom-switch-wrapper')) as HTMLElement[];
          wrapper = cards.find((el) => (el.textContent || '').includes('原创声明')) || null;
        }

        // 策略 2: 全局文本匹配兜底
        if (!wrapper) {
          const allElements = Array.from(document.querySelectorAll('*')) as HTMLElement[];
          const keywords = ['原创声明', '声明原创', '原创作品'];
          const matches = allElements.filter((el) => {
            const txt = (el.textContent || '').trim();
            return keywords.some((kw) => txt.includes(kw)) && el.children.length <= 4 && el.offsetParent !== null;
          });
          if (matches.length > 0) {
            matches.sort((a, b) => (a.textContent || '').trim().length - (b.textContent || '').trim().length);
            let row: HTMLElement = matches[0];
            for (let i = 0; i < 5; i++) {
              if (row.parentElement && row.parentElement !== document.body) {
                row = row.parentElement;
                if (row.querySelector('.d-switch, [role="switch"], [class*="switch"], input[type="checkbox"]')) {
                  wrapper = row;
                  break;
                }
              }
            }
            if (!wrapper) wrapper = row;
          }
        }

        if (!wrapper || wrapper.offsetParent === null) {
          return { found: false, reason: '未在页面中找到【原创声明】模块' };
        }

        // 采用 behavior: 'auto' 瞬间滚动定位，彻底消除平滑滚动过渡期坐标漂移
        wrapper.scrollIntoView({ block: 'center', behavior: 'auto' });

        // 严格检测当前开关是否已处于开启状态：
        // 注意：小红书 Switch 未选中时类名是 "d-switch-simulator unchecked"，含 "checked" 子串，因此必须严格排除 unchecked！
        const simEl = wrapper.querySelector('.d-switch-simulator') as HTMLElement | null;
        const inputEl = wrapper.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        const simClass = (simEl?.className || '').toString();

        const isUnchecked = /\bunchecked\b/.test(simClass);
        const isCheckedClass = (/\bchecked\b/.test(simClass) || /\bis-checked\b/.test(simClass)) && !isUnchecked;
        const isInputChecked = Boolean(inputEl?.checked);

        if (!isUnchecked && (isCheckedClass || isInputChecked)) {
          return { found: true, alreadyChecked: true };
        }

        // 定位点击目标：精准锁定 .d-switch-simulator 滑块中心，避免偏离
        let trigger = (
          wrapper.querySelector('.d-switch-simulator, .d-switch-top, .d-switch, .custom-switch-switch') ||
          wrapper
        ) as HTMLElement;

        const rect = trigger.getBoundingClientRect();
        return {
          found: true,
          alreadyChecked: false,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          wrapperCls: wrapper.className,
        };
      }).catch((e) => ({ found: false, reason: e.message }));

      if (!origLocation || !origLocation.found) {
        await tracer.track(`⚠️ 第 ${attempt} 次探测未找到【原创声明】控件，稍候重试...`, origLocation, 'warn');
        await sleep(1000);
        continue;
      }

      if (origLocation.alreadyChecked) {
        await tracer.track('✅ 检测到【原创声明】当前已处于开启/勾选状态！', null, 'success');
        origConfigured = true;
        break;
      }

      // 执行真实的 CDP 物理鼠标点击开关
      await tracer.track(`🖱️ 正在通过 CDP 真实鼠标点击【原创声明】开关 (${origLocation.x}, ${origLocation.y})...`);
      await client.mouseClick(origLocation.x, origLocation.y, { delayMs: 120 });

      // 点击后等待弹窗出现（小红书通常会弹出 .creator-modal-style 权益须知确认框）
      await sleep(1500);

      // 4. 检查是否有原创协议声明确认弹窗（.creator-modal-style / .d-modal / .d-new-modal 等）
      // 注意：fixed 布局的模态弹窗在所有标准浏览器中 offsetParent 均为 null，绝对不能用 offsetParent 判定可见性！
      let modalHandled = false;
      for (let poll = 0; poll < 12; poll++) {
        const dialogInfo = await client.evaluate(() => {
          const isVisible = (el: HTMLElement | null): boolean => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          // 查找模态框（使用尺寸与样式核验可见性）
          const candidateModals = Array.from(
            document.querySelectorAll('.creator-modal-style, .d-modal, .d-new-modal, [class*="modal"], [role="dialog"]')
          ) as HTMLElement[];
          const origModal = candidateModals.find((m) => {
            if (!isVisible(m)) return false;
            const txt = (m.textContent || '').trim();
            return (
              txt.includes('原创声明') ||
              txt.includes('原创笔记') ||
              txt.includes('原创权益') ||
              txt.includes('原创声明须知') ||
              Boolean(m.querySelector('.originalContainer'))
            );
          });

          if (!origModal) return { hasModal: false };

          // 1. 查找协议复选框（我已阅读并同意《原创声明须知》）
          let cbBox = (
            origModal.querySelector('.footerLeft .d-checkbox') ||
            origModal.querySelector('.d-checkbox') ||
            origModal.querySelector('label')
          ) as HTMLElement | null;

          if (!cbBox) {
            const allCandidates = Array.from(origModal.querySelectorAll('label, div, span, p')) as HTMLElement[];
            cbBox = allCandidates.find((el) => {
              const t = (el.textContent || '').trim();
              return (
                (t.includes('阅读并同意') || t.includes('声明须知') || t.includes('原创权益')) &&
                (el.querySelector('input[type="checkbox"], .d-checkbox-simulator, [class*="checkbox"]') ||
                  el.classList.contains('d-checkbox'))
              );
            }) || null;
          }

          let needAgree = false;
          let agreeCoord = null;

          if (cbBox) {
            const cbSim = cbBox.querySelector('.d-checkbox-simulator, [class*="simulator"], [class*="checkbox-inner"], input[type="checkbox"]') as HTMLElement | null;
            const cbInput = cbBox.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            const cbClass = ((cbBox.className || '') + ' ' + (cbSim?.className || '')).toString();

            const isCbUnchecked = /\bunchecked\b/.test(cbClass);
            const isCbChecked =
              (/\bchecked\b/.test(cbClass) || /\bis-checked\b/.test(cbClass) || Boolean(cbInput?.checked)) &&
              !isCbUnchecked;

            if (!isCbChecked) {
              needAgree = true;
              // 关键高精度优化：
              // 如果找到了真实的方格元素且宽度在合理范围（<=40px），直接点方格中心；
              // 否则无论如何必须锚定在行容器最左侧 12px 处（小方框位置），绝对不能取 width / 2，以防点击到右侧的《原创声明须知》超链接
              const r = cbBox.getBoundingClientRect();
              if (cbSim) {
                const simR = cbSim.getBoundingClientRect();
                if (simR.width > 0 && simR.width <= 40) {
                  agreeCoord = { x: Math.round(simR.left + simR.width / 2), y: Math.round(simR.top + simR.height / 2) };
                } else {
                  agreeCoord = { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
                }
              } else {
                agreeCoord = { x: Math.round(r.left + 12), y: Math.round(r.top + r.height / 2) };
              }
            }
          }

          // 2. 查找【声明原创】按钮
          const btns = Array.from(origModal.querySelectorAll('button, .d-button, [class*="button"]')) as HTMLElement[];
          const confirmBtn = btns.find((b) => {
            const txt = (b.textContent || '').trim();
            return txt.includes('声明原创') || txt.includes('确认') || txt.includes('确定');
          });

          if (confirmBtn) {
            const btnCls = (confirmBtn.className || '').toString();
            const isDisabled =
              Boolean((confirmBtn as HTMLButtonElement).disabled) ||
              /\bdisabled\b/.test(btnCls) ||
              confirmBtn.getAttribute('aria-disabled') === 'true';

            const r = confirmBtn.getBoundingClientRect();
            return {
              hasModal: true,
              needAgree,
              agreeCoord,
              hasBtn: true,
              btnDisabled: isDisabled,
              btnCoord: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
              btnText: (confirmBtn.textContent || '').trim(),
            };
          }

          return { hasModal: true, needAgree, agreeCoord, hasBtn: false };
        }).catch(() => ({ hasModal: false }));

        if (!dialogInfo.hasModal) {
          // 首次未检测到先等待 500ms 重试，连续未检测到则判定为无弹窗直接生效
          if (poll < 2) {
            await sleep(500);
            continue;
          }
          break;
        }

        // 如果需要勾选“我已阅读并同意”
        if (dialogInfo.needAgree && dialogInfo.agreeCoord) {
          await tracer.track('📜 检测到原创权益须知弹窗，正在勾选【我已阅读并同意《原创声明须知》】...');
          await sleep(400); // 模拟人类阅读协议停顿
          await client.mouseClick(dialogInfo.agreeCoord.x, dialogInfo.agreeCoord.y, { delayMs: 120 });
          await sleep(500);

          // 双保险：若 Vue 响应式状态由于事件代理未触发更新，主动触发底层事件与属性变更
          await client.evaluate(() => {
            const candidateModals = Array.from(
              document.querySelectorAll('.creator-modal-style, .d-modal, .d-new-modal, [class*="modal"], [role="dialog"]')
            ) as HTMLElement[];
            const modal = candidateModals.find((m) => {
              const s = window.getComputedStyle(m);
              return s.display !== 'none' && s.visibility !== 'hidden' && (m.textContent || '').includes('原创');
            });
            if (!modal) return;

            let cb = (modal.querySelector('.footerLeft .d-checkbox, .d-checkbox') ||
              modal.querySelector('label')) as HTMLElement | null;
            if (!cb) {
              const allCandidates = Array.from(modal.querySelectorAll('label, div, span')) as HTMLElement[];
              cb = allCandidates.find((el) => (el.textContent || '').includes('阅读并同意')) || null;
            }

            if (cb) {
              const input = cb.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
              if (input) {
                input.checked = true;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
              const sim = cb.querySelector('.d-checkbox-simulator, [class*="simulator"]') as HTMLElement | null;
              const target = sim || cb;
              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtType) => {
                target.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
              });
              cb.click();
            }
          }).catch(() => { });

          await sleep(600); // 等待“声明原创”按钮解除 disabled
          continue; // 下一轮循环检查按钮是否变为可用状态
        }

        // 如果弹窗中有确认按钮且已解除禁用
        if (dialogInfo.hasBtn && dialogInfo.btnCoord) {
          if (dialogInfo.btnDisabled) {
            await sleep(500);
            continue;
          }

          await tracer.track(`🖱️ 正在点击【${dialogInfo.btnText || '声明原创'}】确认按钮...`);
          await sleep(400); // 模拟人类确认前微小停顿
          await client.mouseClick(dialogInfo.btnCoord.x, dialogInfo.btnCoord.y, { delayMs: 120 });

          // DOM 点击兜底辅助
          await client.evaluate(() => {
            const candidateModals = Array.from(
              document.querySelectorAll('.creator-modal-style, .d-modal, .d-new-modal, [class*="modal"], [role="dialog"]')
            ) as HTMLElement[];
            const modal = candidateModals.find((m) => {
              const s = window.getComputedStyle(m);
              return s.display !== 'none' && s.visibility !== 'hidden' && (m.textContent || '').includes('原创');
            });
            if (modal) {
              const btns = Array.from(modal.querySelectorAll('button, .d-button, [class*="button"]')) as HTMLElement[];
              const btn = btns.find((b) => (b.textContent || '').includes('声明原创') || (b.textContent || '').includes('确认'));
              if (btn) btn.click();
            }
          }).catch(() => { });

          // 核心断言：循环等待弹窗彻底关闭
          for (let w = 0; w < 10; w++) {
            await sleep(400);
            const modalStillVisible = await client.evaluate(() => {
              const candidateModals = Array.from(
                document.querySelectorAll('.creator-modal-style, .d-modal, .d-new-modal, [class*="modal"], [role="dialog"]')
              ) as HTMLElement[];
              const m = candidateModals.find((el) => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && (el.textContent || '').includes('原创');
              });
              return Boolean(m);
            }).catch(() => false);

            if (!modalStillVisible) {
              modalHandled = true;
              break;
            }
          }
          break;
        }

        await sleep(500);
      }

      // 安全兜底防护：如果轮询结束后弹窗依然未关闭，强制点击右上角关闭按钮 [X] 或 Esc 键，绝不让模态遮罩阻挡后续流程！
      await client.evaluate(() => {
        const candidateModals = Array.from(
          document.querySelectorAll('.creator-modal-style, .d-modal, .d-new-modal, [class*="modal"], [role="dialog"]')
        ) as HTMLElement[];
        const openModal = candidateModals.find((el) => {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (el.textContent || '').includes('原创');
        });

        if (openModal) {
          // 查找右上角关闭图标/按钮
          const closeBtn = openModal.querySelector(
            '.d-modal-close, [class*="close"], [aria-label*="close"], button:has(svg), svg'
          ) as HTMLElement | null;
          if (closeBtn) {
            closeBtn.click();
          }
        }
      }).catch(() => { });
      await client.pressKey('Escape').catch(() => { });
      await sleep(600);

      // 5. 回检【原创声明】是否成功生效（必须保证弹窗已关闭且开关为开启状态）
      const verifyResult = await client.evaluate(() => {
        // 先确保弹窗已经完全关闭
        const modals = Array.from(
          document.querySelectorAll('.creator-modal-style, .d-modal, .d-new-modal, [class*="modal"], [role="dialog"]')
        ) as HTMLElement[];
        const hasOpenModal = modals.some((m) => {
          const style = window.getComputedStyle(m);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const r = m.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (m.textContent || '').includes('原创');
        });
        if (hasOpenModal) return false;

        let wrapper = document.querySelector('.original-wrapper') as HTMLElement | null;
        if (!wrapper) {
          const cards = Array.from(document.querySelectorAll('.custom-switch-card, .custom-switch-wrapper')) as HTMLElement[];
          wrapper = cards.find((el) => (el.textContent || '').includes('原创声明')) || null;
        }
        if (!wrapper) return false;

        const simEl = wrapper.querySelector('.d-switch-simulator') as HTMLElement | null;
        const inputEl = wrapper.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        const simClass = (simEl?.className || '').toString();

        const isUnchecked = /\bunchecked\b/.test(simClass);
        const isCheckedClass = (/\bchecked\b/.test(simClass) || /\bis-checked\b/.test(simClass)) && !isUnchecked;
        const isInputChecked = Boolean(inputEl?.checked);

        return !isUnchecked && (isCheckedClass || isInputChecked);
      }).catch(() => false);

      if (verifyResult) {
        await tracer.track('🎉 【原创声明】已成功开启并经校验确认生效！', null, 'success');
        origConfigured = true;
        break;
      } else {
        await tracer.track(`⚠️ 第 ${attempt} 次配置【原创声明】后回检未生效，准备重试...`, null, 'warn');
        await sleep(1200);
      }
    }

    if (!origConfigured) {
      await tracer.track('❌ 未能成功开启【原创声明】(可能该账号未达标、该类目不支持或已免审)，跳过继续后续流程', null, 'info');
    }


    // 6. 处理【AI 创作声明/AI生成标注】—— 小红书 custom-select-44 / declaration-wrapper 下拉框
    await tracer.track('⚙️ 正在检查并处理【AI创作声明】(内容类型声明)...');
    try {
      const TARGET_TEXT = '笔记含AI合成内容';
      const TARGET_KEYWORDS = [
        '笔记含AI合成内容',
        '含AI合成内容',
        '包含AI合成内容',
        'AI合成内容',
        'AI生成内容',
        '含AI生成内容',
        '含AI生成',
        'AI生成',
        'AI合成',
        'AI创作',
        'AI辅助',
        'contains ai',
        'ai-generated',
        'ai generated',
        'generated content',
        'ai content',
      ];
      let aiConfigured = false;

      // 1. 先验检查：当前页面是否已经处于“笔记含AI合成内容”选中状态
      const alreadyConfigured = await client.evaluate((keywords: string[]) => {
        // A. 优先直接核验小红书专用类名 .custom-select-44 / .declaration-wrapper 的 description 字段
        const descEl = document.querySelector(
          '.custom-select-44 .d-select-description, [class*="declaration-wrapper"] .d-select-description, .d-select-description'
        );
        const descText = (descEl?.textContent || '').trim();
        if (descText && keywords.some(kw => descText.includes(kw))) {
          return true;
        }

        // B. 全局可见文本核验（排除下拉菜单弹层自身）
        const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
        return all.some((el) => {
          const s = window.getComputedStyle(el);
          if (s.display === 'none' || s.visibility === 'hidden') return false;
          const txt = (el.textContent || '').trim();
          const inDropdown = Boolean(el.closest('.d-select-dropdown, .d-dropdown, [class*="dropdown"], [class*="popover"]'));
          return !inDropdown && keywords.some(kw => txt === kw || (txt.includes(kw) && txt.length <= 25));
        });
      }, TARGET_KEYWORDS).catch(() => false);

      if (alreadyConfigured) {
        await tracer.track(`✅ 【AI创作声明】当前已处于【${TARGET_TEXT}】状态！`, null, 'success');
        aiConfigured = true;
      }

      // 2. 若未配置，执行最多 4 轮微随机扰动点击展开与选项拾取
      for (let attempt = 1; attempt <= 4 && !aiConfigured; attempt++) {
        // A. 寻找并提取小红书【添加内容类型声明】下拉触发器的精确边界
        const triggerBox = await client.evaluate(() => {
          // 策略 1: 优先匹配小红书真实 DOM 类名
          const specific = document.querySelector(
            '.custom-select-44, [class*="declaration-wrapper"], [lass*="declaration-wrapper"], .d-select-wrapper'
          ) as HTMLElement | null;

          let target: HTMLElement | null = null;
          if (specific) {
            const content = specific.querySelector('.d-select-content, .d-select-main, .d-select, .d-select-input') as HTMLElement | null;
            target = content || specific;
          }

          // 策略 2: 文本占位符“添加内容类型声明”或“内容类型声明”
          if (!target) {
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            target = all.find((el) => {
              const txt = (el.textContent || '').trim();
              return (txt === '添加内容类型声明' || txt.includes('添加内容类型声明') || txt.includes('内容类型声明')) && el.children.length <= 3;
            }) || null;
          }

          if (!target) return null;
          target.scrollIntoView({ block: 'center', behavior: 'instant' as any });

          // DOM 层面触发完整的交互事件序列
          try {
            target.click();
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          } catch (e) {}

          const r = target.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return null;
          return {
            left: Math.round(r.left),
            top: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        }).catch(() => null);

        if (!triggerBox) {
          await tracer.track('ℹ️ 未检测到【添加内容类型声明】下拉入口，跳过此步骤', null, 'info');
          break;
        }

        // 微小范围随机化坐标 (Jitter)，不同轮次尝试不同锚点（中心/右侧箭头/左侧）
        const randomJitter = (range: number) => Math.floor((Math.random() - 0.5) * range * 2);
        let clickX = triggerBox.left + Math.round(triggerBox.width / 2) + randomJitter(4);
        let clickY = triggerBox.top + Math.round(triggerBox.height / 2) + randomJitter(3);

        if (attempt === 2) {
          // 第 2 次尝试点击右侧下拉箭头区域
          clickX = triggerBox.left + triggerBox.width - 15 + randomJitter(3);
        } else if (attempt === 3) {
          // 第 3 次尝试点击左侧文字区域
          clickX = triggerBox.left + 25 + randomJitter(4);
        }

        await tracer.track(`🖱️ 正在模拟微随机物理鼠标点击展开【添加内容类型声明】(第 ${attempt} 次: ${clickX}, ${clickY})...`);
        await client.mouseMove(clickX, clickY);
        await sleep(80);
        await client.mouseClick(clickX, clickY, { delayMs: 100 });

        // B. 轮询等待下拉选项弹层（.d-select-dropdown / 全局 options 菜单）呈现
        let optionInfo: { x: number; y: number; text: string } | null = null;
        for (let poll = 0; poll < 12; poll++) {
          await sleep(250);
          optionInfo = await client.evaluate((keywords: string[]) => {
            const isVisible = (el: HTMLElement | null): boolean => {
              if (!el) return false;
              const s = window.getComputedStyle(el);
              if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            };

            // 优先在下拉浮层容器内检索
            const dropdowns = Array.from(document.querySelectorAll(
              '.d-select-dropdown, .d-dropdown, [class*="dropdown"], [class*="popover"], .d-options, [role="listbox"], [role="menu"]'
            )) as HTMLElement[];

            let candidateElements: HTMLElement[] = [];
            if (dropdowns.length > 0) {
              for (const drop of dropdowns) {
                if (isVisible(drop)) {
                  candidateElements.push(...Array.from(drop.querySelectorAll('*')) as HTMLElement[]);
                }
              }
            }
            if (candidateElements.length === 0) {
              candidateElements = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            }

            // 过滤所有匹配关键词的节点（先排除过长文本）
            const matches = candidateElements.filter((el) => {
              const txt = (el.textContent || '').trim();
              return keywords.some((kw) => txt.includes(kw)) && txt.length <= 40;
            });

            if (matches.length === 0) return null;

            // 优先选择最具体的叶子节点（无子元素或仅 1 个子元素）
            const leafMatches = matches.filter((el) => el.children.length <= 1);
            const target = leafMatches.length > 0 ? leafMatches[leafMatches.length - 1] : matches[matches.length - 1];

            // 确保选项滚入视口并具备尺寸
            target.scrollIntoView({ block: 'nearest', behavior: 'instant' as any });

            // DOM 层面优先触发事件与聚焦
            try {
              target.focus();
              target.click();
              target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            } catch (e) {}

            const r = target.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return null;

            return {
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
              text: (target.textContent || '').trim(),
            };
          }, TARGET_KEYWORDS).catch(() => null);

          if (optionInfo) break;
        }

        // C. 点击选定目标选项（带微扰动）
        if (optionInfo) {
          const optX = optionInfo.x + randomJitter(3);
          const optY = optionInfo.y + randomJitter(2);
          await tracer.track(`🎯 锁定下拉选项【${optionInfo.text || TARGET_TEXT}】，发起拟人物理鼠标点击 (${optX}, ${optY})...`);
          await client.mouseMove(optX, optY);
          await sleep(80);
          await client.mouseClick(optX, optY, { delayMs: 100 });

          // DOM 点击兜底双重保障
          await client.evaluate((keywords: string[]) => {
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            const hits = all.filter((el) => {
              const txt = (el.textContent || '').trim();
              return keywords.some((kw) => txt === kw || txt.includes(kw)) && txt.length <= 30;
            });
            if (hits.length > 0) {
              const opt = hits[hits.length - 1];
              try {
                opt.click();
                opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                opt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              } catch (e) {}
            }
          }, TARGET_KEYWORDS).catch(() => {});

          await sleep(800);

          // D. 确认回检是否生效
          const isConfirmed = await client.evaluate((keywords: string[]) => {
            const desc = document.querySelector(
              '.custom-select-44 .d-select-description, [class*="declaration-wrapper"] .d-select-description, .d-select-description'
            );
            const descText = (desc?.textContent || '').trim();
            if (descText && keywords.some(kw => descText.includes(kw))) {
              return true;
            }
            const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
            return all.some((el) => {
              const s = window.getComputedStyle(el);
              if (s.display === 'none' || s.visibility === 'hidden') return false;
              const txt = (el.textContent || '').trim();
              const inDropdown = Boolean(el.closest('.d-select-dropdown, .d-dropdown, [class*="dropdown"]'));
              return !inDropdown && keywords.some(kw => txt === kw || (txt.includes(kw) && txt.length <= 25));
            });
          }, TARGET_KEYWORDS).catch(() => false);

          if (isConfirmed) {
            await tracer.track('🎉 【AI创作声明】已成功选取并确认生效: 【笔记含AI合成内容】！', null, 'success');
            aiConfigured = true;
            break;
          } else {
            await tracer.track(`⚠️ 第 ${attempt} 次点击选项后回检尚未更新，准备重试...`, null, 'warn');
            await sleep(800);
          }
        } else {
          await tracer.track(`⚠️ 未能在下拉列表中定位到【${TARGET_TEXT}】选项，微调坐标重试 (第 ${attempt} 次)...`, null, 'warn');
          await sleep(600);
        }
      }

      if (!aiConfigured) {
        await tracer.track('ℹ️ 【AI创作声明】配置已尽最大努力尝试，继续后续发布流程', null, 'info');
      }
    } catch (e: any) {
      await tracer.track(`⚠️ 【AI创作声明】处理异常: ${e?.message || e}`, null, 'warn');
    }

    // 6.5 处理【定时发布】(若指定了未来计划时间)
    try {
      const hasScheduledTime = Boolean(payload?.scheduledPublishAt && payload.scheduledPublishAt > Date.now());
      if (hasScheduledTime) {
        await tracer.track('⚙️ 正在检查并配置小红书【定时发布】...');
        const targetTimestamp = payload!.scheduledPublishAt!;
        const targetDate = new Date(targetTimestamp);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timeStr = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())} ${pad(targetDate.getHours())}:${pad(targetDate.getMinutes())}`;

        const timedCoord = await client.evaluate(() => {
          const all = Array.from(document.querySelectorAll('label, .d-radio, [role="radio"], .d-switch, span, div')) as HTMLElement[];
          const timedEl = all.find((el) => {
            const txt = (el.textContent || '').trim();
            return (txt === '定时发布' || txt.includes('定时发布')) && el.children.length <= 3 && el.offsetParent !== null;
          });
          if (timedEl) {
            timedEl.scrollIntoView({ block: 'center', behavior: 'auto' });
            const r = timedEl.getBoundingClientRect();
            return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
          }
          return { found: false };
        }).catch(() => ({ found: false }));

        if (timedCoord && timedCoord.found && timedCoord.x && timedCoord.y) {
          await client.mouseClick(timedCoord.x, timedCoord.y);
          await sleep(600);

          // 尝试查找并点击激活日期时间输入控件
          const dateInputCoord = await client.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input.d-input__inner, input[placeholder*="日期"], input[placeholder*="时间"], .d-date-picker input, .d-picker input')) as HTMLInputElement[];
            const targetInput = inputs.find(inp => inp.offsetParent !== null && !inp.disabled);
            if (targetInput) {
              targetInput.scrollIntoView({ block: 'center', behavior: 'auto' });
              const r = targetInput.getBoundingClientRect();
              return { found: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
            return { found: false };
          }).catch(() => ({ found: false }));

          if (dateInputCoord.found && dateInputCoord.x && dateInputCoord.y) {
            await client.mouseClick(dateInputCoord.x, dateInputCoord.y);
            await sleep(400);
          }

          await tracer.track(`✅ 已切换为小红书定时发布模式 (${timeStr})`, null, 'success');
        }
      } else {
        await tracer.track('⚡ [定时发布] 未指定计划发布时间，保持【立即发布】模式', null, 'info');
      }
    } catch (e: any) {
      await tracer.track(`⚠️ [定时发布] 处理略过: ${e?.message || e}`, null, 'warn');
    }

    // 7. 配置完成后，将视口平滑滚动回发布按钮位置
    await client.evaluate(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' });
    });
    await sleep(500);
  }

  /**
   * 执行完整的自动化发布流程（直连 CDP 页面控制器 + 全链路追踪）
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
        platform: 'xiaohongshu',
        webContents: adapter.webContents,
        steps: getPlatformPublishSteps('xiaohongshu', activeLang),
        onStatusUpdate,
        signal,
        lang: activeLang,
      });

      await tracer.track('🚀 小红书自动化发布流程启动', {
        主页地址: this.homeUrl,
        发布地址: this.publishUrl,
        视频文件: localVideoPath || '未提供视频',
        标题: payload.title,
      });

      adapter.show();
      adapter.focus();

      await tracer.updateStep(0, 'active');

      // 1. 第一步：先进行严格的登录状态检查；未登录时坚决停留等待用户扫码，绝对不继续往下执行！
      checkAborted();
      let isLoggedIn = await this.checkLoginStatus(adapter.webContents);

      // 自愈重试：若初步未检测到登录，先在最外层执行一次整体页面平滑刷新自愈重测（唤醒本地 Cookie 握手）
      if (!isLoggedIn) {
        checkAborted();
        await tracer.track('⏳ 初步检测到小红书登录态可能失活，正在执行外层整页刷新自愈重测...');
        adapter.webContents.reload();
        await sleep(2500, signal);
        while (adapter.webContents.isLoading()) {
          checkAborted();
          await sleep(500, signal);
        }
        await sleep(1500, signal);
        checkAborted();
        isLoggedIn = await this.checkLoginStatus(adapter.webContents);
        if (isLoggedIn) {
          await tracer.track('🎉 外层整页刷新自愈成功，小红书登录态已满血恢复！', null, 'success');
        }
      }

      if (!isLoggedIn) {
        checkAborted();
        const currentUrl = adapter.webContents.getURL();
        if (!currentUrl.includes('/new/home')) {
          await tracer.track('⏳ 正在打开小红书创作者服务平台主页进行登录...', null, 'info', { persistent: true });
          await adapter.loadURL(this.homeUrl);
          await sleep(2000, signal);
        }

        checkAborted();
        await tracer.updateStep(0, 'active');
        await tracer.track('⏳ 检测到小红书尚未登录，请在窗口中使用手机小红书 App 扫码登录 (登录成功后将自动继续)...', null, 'warn', { persistent: true });
        const loginSuccess = await this.waitForLogin(adapter.webContents, tracer, 300000, signal);
        if (!loginSuccess) {
          checkAborted();
          await tracer.updateStep(0, 'error');
          await tracer.track('❌ 小红书登录超时或未完成扫码，自动化流程强行终止！', null, 'error', { persistent: true });
          return {
            success: false,
            platform: 'xiaohongshu',
            message: this.formatLog('小红书未登录或登录超时，已终止后续自动化操作', activeLang),
          };
        }

        checkAborted();
        // 扫码登录成功后，等待主页重定向完成、会话稳定
        await tracer.track('✅ 检测到小红书用户已成功扫码登录！正在等待主页数据稳定...', null, 'success');
        await sleep(2500, signal);
        while (adapter.webContents.isLoading()) {
          checkAborted();
          await sleep(500, signal);
        }
      } else {
        await tracer.track('✅ 检测到小红书用户当前已处于有效登录态！', null, 'success');
      }

    // 2. 第二步：确认登录成功后，建立或刷新 CDP 客户端
    let client: CdpPageClient;
    try {
      client = await adapter.getCdpClient();
      tracer.setClient(client);
    } catch (cdpErr: any) {
      await tracer.updateStep(0, 'error');
      await tracer.track(`连接 CDP WebSocket 失败: ${cdpErr.message}`, cdpErr.stack, 'error');
      return { success: false, platform: 'xiaohongshu', message: cdpErr.message };
    }

    // 3. 第三步：确认登录成功后，再进行到发布页面！
    await tracer.track('🚀 确认登录成功，准备从主页进入新建视频发布页面...');
    await this.navigateToNewPostPage(client, tracer, adapter);

    // 确定性保障：核验当前 URL 是否已真实进入发布页，若未进入则强制导航进入发布页
    const nowUrl = adapter.webContents.getURL();
    if (!nowUrl.includes('/publish') || nowUrl.includes('/new/home')) {
      await tracer.track('⏳ 正在确保进入小红书新建视频发布页面...');
      await adapter.loadURL(this.publishUrl);
      await sleep(2500, signal);
      while (adapter.webContents.isLoading()) {
        await sleep(500, signal);
      }
      await sleep(1000, signal);
    }

    // 页面进入发布页后，刷新 CDP 连接避免旧 Target 销毁
    await sleep(1000, signal);
    while (adapter.webContents.isLoading()) {
      await sleep(500, signal);
    }
    try {
      client = await adapter.getCdpClient();
      tracer.setClient(client);
    } catch { }

    // 4. 第四步：严格等待发布页面脱离白屏、组件渲染完成
    await this.waitForPublishPageReady(client, tracer, 35000, signal, adapter);

    // 用户规则：网页就绪后提示“网络就绪”，模拟人的行为等待3-5秒，再做下一个动作
    await tracer.track('🌐 网络就绪！小红书新建视频界面已加载完成', null, 'success');
    await waitHumanInterval(tracer, 3000, 5000, '网络就绪，正在模拟人工审视发布页面');
    // 动作 1：清理新手提示弹窗
    await this.dismissDialogs(client, tracer);
    await waitHumanInterval(tracer, 1000, 3000, '弹窗清理完毕，准备执行页面输入控件深度诊断');

    // 动作 2：深度诊断当前页面 DOM
    await tracer.diagnosePageInputs(client);
    await waitHumanInterval(tracer, 1000, 3000, 'DOM 诊断完成，准备开始上传短视频素材');

    await tracer.updateStep(0, 'done');
    await tracer.updateStep(1, 'active');

    // 动作 3：确保处于“上传视频”模式，并原生上传本地短视频素材
    await tracer.track('[小红书] 确保处于【上传视频】模式，准备注入本地视频素材...');
    const tabCoord = await client.evaluate(() => {
      const allTabs = Array.from(document.querySelectorAll('.tab, .tab-item, [role="tab"], div, span, button')) as HTMLElement[];
      const videoTab: any = allTabs.find((el) => {
        const txt = (el.textContent || '').trim();
        return (txt === '上传视频' || txt === '视频笔记' || txt === '视频') && el.children.length <= 2;
      });
      if (videoTab && !videoTab.classList.contains('active') && !videoTab.classList.contains('is-active')) {
        videoTab.scrollIntoView({ behavior: 'auto', block: 'center' });
        const r = videoTab.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
      return null;
    }).catch(() => null);

    if (tabCoord && tabCoord.x && tabCoord.y) {
      await client.mouseClick(tabCoord.x, tabCoord.y);
    }
    await sleep(600);

    if (localVideoPath && fs.existsSync(localVideoPath)) {
      const uploaded = await this.uploadVideoViaCdp(client, localVideoPath, tracer);
      if (uploaded) {
        await tracer.track('视频素材已成功注入，正在等待小红书解析视频与生成封面...', null, 'success');
        const formReady = await this.waitForEditFormReady(client, tracer, 30000);
        if (!formReady) {
          await tracer.updateStep(1, 'error');
          await tracer.track('❌ 等待小红书解析视频与发布表单挂载超时，发布流程强行终止！', null, 'error', { persistent: true });
          return {
            success: false,
            platform: 'xiaohongshu',
            message: this.formatLog('小红书解析视频与表单挂载超时，已终止后续发布操作', activeLang),
          };
        }
      } else {
        await tracer.updateStep(1, 'error');
        await tracer.track('❌ 未能自动触发小红书上传控件，发布流程强行终止！', null, 'error', { persistent: true });
        return {
          success: false,
          platform: 'xiaohongshu',
          message: this.formatLog('❌未能自动触发视频上传控件，已终止后续发布操作', activeLang),
        };
      }
    } else {
      await tracer.updateStep(1, 'error');
      await tracer.track('❌ 未找到本地短视频文件，发布流程强行终止！', { 路径: localVideoPath }, 'error', { persistent: true });
      return {
        success: false,
        platform: 'xiaohongshu',
        message: this.formatLog('未找到本地视频文件，已终止后续发布操作', activeLang),
      };
    }

    await tracer.updateStep(1, 'done');
    await waitHumanInterval(tracer, 1000, 3000, '视频素材处理就绪，准备写入笔记标题');

    // 动作 4：填写标题（小红书限 20 字符）
    await tracer.updateStep(2, 'active');
    const cleanTitle = (payload.title || '')
      .replace(/#[\w\u4e00-\u9fa5]+/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 20);

    if (cleanTitle) {
      const titleCandidates = [
        'input.d-input__inner',
        'input[placeholder*="标题"]',
        'input[placeholder*="填写标题"]',
        '.post-title input',
        'input[type="text"]',
      ];
      const titleSuccess = await tracer.smartFillInput(client, '小红书笔记标题', titleCandidates, cleanTitle, { maxLength: 20 });
      if (!titleSuccess) {
        await tracer.updateStep(2, 'error');
        await tracer.track('❌ 小红书笔记标题控件未能定位或填入失败，发布流程强行终止！', null, 'error', { persistent: true });
        return {
          success: false,
          platform: 'xiaohongshu',
          message: this.formatLog('未定位到小红书笔记标题控件，为防止异常发布已终止后续流程', activeLang),
        };
      }
      await tracer.updateStep(2, 'done');
      await waitHumanInterval(tracer, 1000, 3000, '笔记标题已填入，准备填入正文与话题标签');
    } else {
      await tracer.updateStep(2, 'done');
    }

    // 动作 5：填写正文与话题
    await tracer.updateStep(3, 'active');
    const descTags =
      payload.tags && payload.tags.length > 0
        ? `\n\n${payload.tags.map((t) => `#${t.replace(/^#/, '')} `).join('')}`
        : '\n\n#英语学习 #英语词汇 #知识分享 ';
    const fullDesc = `${payload.description || ''}${descTags}`.trim();

    if (fullDesc) {
      const editorCandidates = [
        '#post-textarea',
        '[contenteditable]',
        '.ql-editor',
        '.c-editor',
        'textarea',
      ];
      const descSuccess = await tracer.smartFillEditor(client, '小红书笔记正文与话题', editorCandidates, fullDesc);
      if (!descSuccess) {
        await tracer.updateStep(3, 'error');
        await tracer.track('❌ 小红书正文与话题编辑框未能定位或填入失败，发布流程强行终止！', null, 'error', { persistent: true });
        return {
          success: false,
          platform: 'xiaohongshu',
          message: this.formatLog('❌未定位到小红书正文编辑框，为防止异常发布已终止后续流程', activeLang),
        };
      }
      await tracer.updateStep(3, 'done');
      await waitHumanInterval(tracer, 1000, 3000, '正文与话题已全部注入，准备检查高级发布选项与声明');
    } else {
      await tracer.updateStep(3, 'done');
    }

    // 动作 5.5：检查并配置小红书高级选项（原创声明、AI标注、定时发布等）
    await tracer.updateStep(4, 'active');
    await this.configurePublishOptions(client, tracer, payload);
    await tracer.updateStep(4, 'done');
    await waitHumanInterval(tracer, 1000, 2000, '高级发布选项配置完毕');

    // 动作 5.6：用户规则——所有信息填写完成以后，先上翻页到顶部，停留 2-3 秒，然后再回到底部，停 1-2 秒，然后点击发布
    await tracer.track('📜 [发布复核] 视频素材与所有表单文案已填写完成，正在平滑上翻页到顶部 (停留 2-3 秒)...');
    try {
      await client.evaluate(() => {
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
        try { document.documentElement?.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
        try { document.body?.scrollTo({ top: 0, behavior: 'smooth' }); } catch { }
        try {
          const all = Array.from(document.querySelectorAll('*'));
          for (const el of all) {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
              el.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }
        } catch { }
      });
      await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 300, deltaX: 0, deltaY: -600 });
    } catch { }

    // 顶部停留 2-3 秒（模拟人工通篇审视全貌）
    await waitHumanInterval(tracer, 2000, 3000, '已处于页面顶部，正在通篇审视笔记内容与封面');

    // 然后再回到底部
    await tracer.track('📜 [发布复核] 页面通篇审视完毕，正在平滑回到底部 (停留 1-2 秒)...');
    try {
      await client.evaluate(() => {
        const maxH = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, 99999);
        try { window.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
        try { document.documentElement?.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
        try { document.body?.scrollTo({ top: maxH, behavior: 'smooth' }); } catch { }
        try {
          const all = Array.from(document.querySelectorAll('*'));
          for (const el of all) {
            if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
              el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            }
          }
        } catch { }
      });
      await client.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 500, deltaX: 0, deltaY: 600 });
    } catch { }

    // 底部停留 1-2 秒（模拟人工聚焦发布按钮）
    await waitHumanInterval(tracer, 1000, 2000, '已回到底部发布区域，正在核验发布按钮');

    // 动作 6：准备点击发布
    await tracer.updateStep(5, 'active');
    await tracer.track('⏳ 正在检查小红书发布状态与“发布”按钮激活状态...', null, 'info', { persistent: true });

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

      // 如果整体等待超过 15 分钟兜底退出
      if (Date.now() - uploadActiveStart > MAX_UPLOAD_WAIT_MS) {
        await tracer.track('❌ 等待小红书视频上传超过最大时限 (15分钟)，已终止发布流程', null, 'error', { persistent: true });
        break;
      }

      try {
        // 核心监测 1：全面精准监测小红书视频上传真实状态
        const uploadState = await client.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : '';

          // A. 视频上传失败特征
          const isFailed =
            bodyText.includes('上传失败') ||
            bodyText.includes('网络异常，请稍后重试') ||
            bodyText.includes('网络异常') ||
            bodyText.includes('请稍后重试') ||
            bodyText.includes('视频上传失败') ||
            bodyText.includes('格式不支持') ||
            bodyText.includes('文件损坏');

          // B. 视频正在上传中特征 (支持多模式进度匹配: 33%、上传中 33%、已上传 33% 以及 DOM 进度条)
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
            document.querySelector('.d-progress, .ant-progress, [class*="upload-progress"], [class*="progress-bar"], [class*="Progress"]')
          );

          const isUploading = Boolean(
            detectedPct ||
            hasProgressDom ||
            bodyText.includes('上传中') ||
            bodyText.includes('正在上传') ||
            bodyText.includes('正在转码') ||
            bodyText.includes('转码中') ||
            bodyText.includes('正在解析') ||
            bodyText.includes('正在处理')
          );

          // C. 查找【重新上传】按钮
          let reuploadCoord: { x: number; y: number } | null = null;
          const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
          const reuploadBtn = all.find((el) => {
            const txt = (el.textContent || '').trim();
            const cls = (el.className || '').toString();
            return (txt === '重新上传' || txt.includes('重新上传') || cls.includes('reupload')) && el.children.length <= 2 && el.offsetParent !== null;
          });
          if (reuploadBtn) {
            const r = reuploadBtn.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              reuploadCoord = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            }
          }

          return {
            isFailed,
            isUploading,
            uploadProgress: detectedPct || (bodyText.includes('上传中') ? '上传中' : null),
            reuploadCoord,
          };
        }).catch(() => null);

        // 如果检测到上传失败：用户规则——若失败则尝试重新上传一次，仍失败坚决不发布！
        if (uploadState?.isFailed) {
          if (retryUploadCount < maxUploadRetries && localVideoPath && fs.existsSync(localVideoPath)) {
            retryUploadCount++;
            await tracer.track(`⚠️ 检测到小红书视频上传失败 (网络异常，请稍后重试)，准备执行重新上传 (第 ${retryUploadCount} 次重试)...`, null, 'warn', { persistent: true });

            if (uploadState.reuploadCoord) {
              await client.mouseClick(uploadState.reuploadCoord.x, uploadState.reuploadCoord.y);
              await sleep(1000);
            }

            await tracer.track('正在重新注入本地短视频素材并等待上传...');
            await this.uploadVideoViaCdp(client, localVideoPath, tracer);
            await sleep(3000);
            i = 0; // 重置计数器，重新进入等待
            uploadActiveStart = Date.now();
            continue;
          } else {
            // 已无重试机会依然失败：坚决不要做发布操作！
            await tracer.updateStep(5, 'error');
            await tracer.track('❌ 小红书视频上传失败（网络异常，请稍后重试），已坚决终止发布操作，避免发布异常空内容！', null, 'error', { persistent: true });
            return {
              success: false,
              platform: 'xiaohongshu',
              message: this.formatLog('小红书视频上传失败: 网络异常，请稍后重试，已终止发布', activeLang),
            };
          }
        }

        // 如果仍在上传中：用户规则——必须等待视频上传成功！只要有进度推进或处于上传状态，动态维持等待
        if (uploadState?.isUploading) {
          const currentProgress = uploadState.uploadProgress || '处理中';
          const now = Date.now();
          if (currentProgress !== lastReportedProgress || now - lastProgressLogTime > 6000) {
            await tracer.track(`⏳ 小红书视频正在上传中 (${currentProgress})，持续等待上传成功...`, null, 'info', { persistent: true });
            lastReportedProgress = currentProgress;
            lastProgressLogTime = now;
          }
          // 只要处于活跃上传状态，重置循环计数器，避免循环自然耗尽退出
          i = Math.min(i, 10);
          await sleep(2000, signal);
          continue;
        }

        // 核心监测 2：发布按钮就绪状态
        const btnState = await client.evaluate(() => {
          // 1. 优先适配小红书 Web Component 组件 <xhs-publish-btn>
          const xhsHost = document.querySelector('xhs-publish-btn') as HTMLElement | null;
          if (xhsHost) {
            const isSubmitDisabled = xhsHost.getAttribute('submit-disabled') === 'true';
            const isSubmitLoading = xhsHost.getAttribute('submit-loading') === 'true';
            const allShadowBtns = Array.from(xhsHost.shadowRoot?.querySelectorAll('button') || []) as HTMLButtonElement[];
            const shadowBtn = allShadowBtns.find((b) => {
              const txt = (b.textContent || '').trim();
              const cls = (b.className || '').toString();
              const isNotDraft = !txt.includes('暂存') && !cls.includes('white');
              return isNotDraft && (txt === '发布' || cls.includes('bg-red'));
            }) || null;

            if (shadowBtn) {
              const isDisabled = shadowBtn.disabled || isSubmitDisabled || shadowBtn.getAttribute('aria-disabled') === 'true';
              return { found: true, enabled: !isDisabled && !isSubmitLoading, isXhsComponent: true };
            }
            return { found: true, enabled: !isSubmitDisabled && !isSubmitLoading, isXhsComponent: true };
          }

          // 2. 普通 DOM 与标准 button 匹配
          const btns = Array.from(document.querySelectorAll('button, .ce-btn, [class*="publish-btn"]')) as HTMLElement[];
          const pubBtn = btns.find((b) => {
            const txt = (b.textContent || (b as any).innerText || '').trim();
            const cls = (b.className || '').toString();
            const isNotDraft = !txt.includes('暂存') && !cls.includes('white');
            return isNotDraft && (txt === '发布' || cls.includes('bg-red')) && b.offsetParent !== null;
          }) as HTMLButtonElement | undefined;

          if (!pubBtn) return { found: false, enabled: false, isXhsComponent: false };
          const disabled = pubBtn.disabled || pubBtn.getAttribute('disabled') !== null || pubBtn.getAttribute('aria-disabled') === 'true' || pubBtn.classList.contains('disabled');
          return { found: true, enabled: !disabled, isXhsComponent: false };
        });

        const pageHealth = await client.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : '';
          const hasErrorText =
            bodyText.includes('标题长度不能超过') ||
            bodyText.includes('请上传视频') ||
            bodyText.includes('请选择封面') ||
            bodyText.includes('标题不能为空') ||
            bodyText.includes('敏感词') ||
            bodyText.includes('包含违规');

          const errorNodes = Array.from(
            document.querySelectorAll(
              '.d-form-item-explain-error, .ant-form-item-explain-error, .error-message, .error-tip, .input-error, [class*="error-text"], [class*="form-error"]'
            )
          ) as HTMLElement[];
          const visibleError = errorNodes.find((el) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.offsetHeight > 0 && !(el.textContent || '').includes('成功');
          });

          return {
            hasError: Boolean(hasErrorText || visibleError),
            errorMsg: visibleError ? (visibleError.textContent || '').trim() : (hasErrorText ? '检测到表单未通过项' : ''),
          };
        }).catch(() => null);

        if (btnState.found && btnState.enabled && !pageHealth?.hasError && !uploadState?.isUploading && !uploadState?.isFailed) {
          canPublish = true;
          await tracer.track('✅ 检测到小红书视频已上传成功、“发布”按钮已就绪且表单无异常！', null, 'success');
          break;
        } else if (pageHealth?.hasError) {
          await tracer.track(`⚠️ 检测到表单提示项: ${pageHealth.errorMsg || '请核对表单输入'}`, null, 'warn');
        }
      } catch { }
      await sleep(1500, signal);
    }

    if (canPublish) {
      // ── 点击发布前最终上传状态二次核验 ──────────────────────────────────────────
      // 规则：在实际点击【发布】按钮之前，再做一次实时轮询确认：
      //   · 仍在上传中    → 每 3 秒轮询一次，直到上传完成方可点击发布
      //   · 上传失败      → 先触发重新上传一次，重传后重新进入等待；仍失败则终止
      //   · evaluate 异常  → sleep 2s 后重试，不轻易认定上传完成
      //   · 超时（360s）  → 坚决终止，不做发布操作，避免提交异常内容
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
              bodyText.includes('上传失败') ||
              bodyText.includes('网络异常，请稍后重试') ||
              bodyText.includes('网络异常') ||
              bodyText.includes('请稍后重试') ||
              bodyText.includes('视频上传失败') ||
              bodyText.includes('格式不支持') ||
              bodyText.includes('文件损坏');

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
              document.querySelector('.d-progress, .ant-progress, [class*="upload-progress"], [class*="progress-bar"], [class*="Progress"]')
            );

            const isUploading = Boolean(
              detectedPct ||
              hasProgressDom ||
              bodyText.includes('上传中') ||
              bodyText.includes('正在上传') ||
              bodyText.includes('正在转码') ||
              bodyText.includes('转码中') ||
              bodyText.includes('正在解析') ||
              bodyText.includes('正在处理')
            );
            // 仅当上传失败时才扫 DOM 找【重新上传】按钮，减少正常轮询时的开销
            let reuploadCoord: { x: number; y: number } | null = null;
            if (isFailed) {
              const all = Array.from(document.querySelectorAll('*')) as HTMLElement[];
              const reuploadBtn = all.find((el) => {
                const txt = (el.textContent || '').trim();
                const cls = (el.className || '').toString();
                return (txt === '重新上传' || txt.includes('重新上传') || cls.includes('reupload')) && el.children.length <= 2 && el.offsetParent !== null;
              });
              if (reuploadBtn) {
                const r = reuploadBtn.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  reuploadCoord = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                }
              }
            }
            return { isFailed, isUploading, uploadProgress: detectedPct || (bodyText.includes('上传中') ? '上传中' : null), reuploadCoord };
          }).catch(() => null);

          if (uploadState === null) {
            // evaluate 异常，不轻易认定上传完成，等待并重试
            await sleep(2000, signal);
            continue;
          }
          if (uploadState.isFailed) {
            // 上传失败：若还有重试机会则重传，否则终止
            if (finalRetryCount < maxFinalRetries && localVideoPath && fs.existsSync(localVideoPath)) {
              finalRetryCount++;
              await tracer.track(`⚠️ [发布前最终检查] 检测到视频上传失败，正在执行重新上传 (第 ${finalRetryCount} 次)...`, null, 'warn', { persistent: true });
              if (uploadState.reuploadCoord) {
                await client.mouseClick(uploadState.reuploadCoord.x, uploadState.reuploadCoord.y);
                await sleep(1000);
              }
              await tracer.track('正在重新注入本地短视频素材，等待重新上传启动...');
              await this.uploadVideoViaCdp(client, localVideoPath, tracer);
              await sleep(5000); // 多等 5 秒让上传真正启动后再轮询
              fwait = -1; // 修正：continue 后 fwait++ 使其从 0 重新开始完整轮询
              continue;
            } else {
              await tracer.updateStep(5, 'error');
              await tracer.track('❌ [发布前最终检查] 视频上传失败且无重试机会，已终止发布！', null, 'error', { persistent: true });
              return { success: false, platform: 'xiaohongshu', message: this.formatLog('小红书视频上传失败: 网络异常，已终止发布', activeLang) };
            }
          }

          if (uploadState.isUploading) {
            await tracer.track(`⏳ [发布前最终检查] 视频仍在上传中 (${uploadState.uploadProgress || '处理中'})，3 秒后重新检查...`, null, 'info', { persistent: true });
            await sleep(3000, signal);
            continue;
          }

          // 上传已完成且无失败标志，可以继续发布
          finalUploadOk = true;
          break;
        } catch { }
        await sleep(2000, signal);
      }

      // 超时兜底：360 秒内未完成上传，坚决终止发布，避免提交异常内容
      if (!finalUploadOk) {
        await tracer.updateStep(5, 'error');
        await tracer.track('❌ [发布前最终检查] 等待视频上传超时（超过 360 秒），已坚决终止发布！', null, 'error', { persistent: true });
        return { success: false, platform: 'xiaohongshu', message: this.formatLog('小红书视频上传等待超时（>360s），已终止发布', activeLang) };
      }
      // ────────────────────────────────────────────────────────────────────────────

      await tracer.track('正在精准定位小红书【发布】按钮并自动点击提交...');
      try {
        const pubBtnCoord = await client.evaluate(() => {
          // 辅助函数：判断元素是否在视口可见
          const isVisible = (el: HTMLElement | null): boolean => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          // 1. 深度穿透小红书 Web Component / Vue 宿主 <xhs-publish-btn>
          const xhsHost = document.querySelector('xhs-publish-btn') as HTMLElement | null;
          if (xhsHost) {
            xhsHost.scrollIntoView({ block: 'center', behavior: 'auto' });

            // A. 在 xhsHost 自身的所有直接与深层子元素中查找
            const allInnerEls = Array.from(xhsHost.querySelectorAll('*')) as HTMLElement[];
            // B. 在 xhsHost 的 ShadowRoot（若有）中查找
            const allShadowEls = Array.from(xhsHost.shadowRoot?.querySelectorAll('*') || []) as HTMLElement[];
            const candidateEls = [...allInnerEls, ...allShadowEls];

            // 优先匹配文本完全为“发布”或包含“发布”（排除“暂存”、“草稿”、“取消”）的按钮或可点击元素
            let targetInner = candidateEls.find((el) => {
              const txt = (el.textContent || '').trim();
              const cls = (el.className || '').toString();
              const isNotDraft = !txt.includes('暂存') && !txt.includes('草稿') && !cls.includes('white');
              return isNotDraft && (txt === '发布' || cls.includes('bg-red') || cls.includes('submit')) && isVisible(el);
            });

            // 若未找到精确文本，寻找所有非暂存的 button
            if (!targetInner) {
              const buttons = candidateEls.filter(el => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
              targetInner = buttons.find(b => {
                const txt = (b.textContent || '').trim();
                return !txt.includes('暂存') && !txt.includes('离开');
              }) || buttons[buttons.length - 1];
            }

            if (targetInner && isVisible(targetInner)) {
              try {
                targetInner.click();
                targetInner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              } catch (e) {}
              const r = targetInner.getBoundingClientRect();
              return {
                found: true,
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2),
                source: 'xhs-component-inner-element',
              };
            }

            // 若内部被 closed shadow 封装无法直接查询子节点，基于宿主布局精准计算
            const hostRect = xhsHost.getBoundingClientRect();
            if (hostRect.width > 0 && hostRect.height > 0) {
              try {
                xhsHost.click();
                xhsHost.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              } catch (e) {}

              // xhs-publish-btn 通常在底部工具栏，若为双按钮，发布按钮位于右侧约 30%~40% 区域（或 right - 50px）
              const isDualBtn = xhsHost.hasAttribute('save-text') || xhsHost.getAttribute('is-save-draft') === 'true';
              const targetX = isDualBtn
                ? (hostRect.width > 240 ? Math.round(hostRect.right - 55) : Math.round(hostRect.left + (hostRect.width * 0.75)))
                : Math.round(hostRect.left + hostRect.width / 2);

              return {
                found: true,
                x: targetX,
                y: Math.round(hostRect.top + hostRect.height / 2),
                source: 'xhs-host-calculated-submit-point',
              };
            }
          }

          // 2. 全局 DOM 树查找红色发布按钮（严格排除暂存离开、定时发表标签）
          const allEls = Array.from(document.querySelectorAll('button, .ce-btn, [class*="publish-btn"], [class*="submit-btn"], div, span')) as HTMLElement[];
          const pubBtn = allEls.find((b) => {
            const txt = (b.textContent || '').trim();
            const cls = (b.className || '').toString();
            const isNotDraft = !txt.includes('暂存') && !txt.includes('草稿') && !txt.includes('定时发表') && !cls.includes('white');
            const isSubmitBtn = b.tagName === 'BUTTON' || cls.includes('btn') || cls.includes('submit') || cls.includes('publish');
            return isNotDraft && isSubmitBtn && (txt === '发布' || cls.includes('bg-red')) && isVisible(b);
          });

          if (pubBtn) {
            pubBtn.scrollIntoView({ block: 'center', behavior: 'auto' });
            try {
              pubBtn.click();
              pubBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            } catch (e) {}
            const rect = pubBtn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return {
                found: true,
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                source: 'global-red-publish-button',
              };
            }
          }

          return { found: false };
        }).catch(() => null);

        let finalCoord: { x: number; y: number; source: string } | null = null;
        if (pubBtnCoord && pubBtnCoord.found && pubBtnCoord.x && pubBtnCoord.y) {
          finalCoord = {
            x: pubBtnCoord.x,
            y: pubBtnCoord.y,
            source: pubBtnCoord.source,
          };
        }

        // 优先使用 CDP 原生 DOM.getBoxModel 深度穿透定位
        if (!finalCoord) {
          const cdpBox = await client.getElementBoxModel('//button[(contains(text(),"发布") or contains(@class,"bg-red")) and not(contains(text(),"暂存")) and not(contains(@class,"white"))]');
          if (cdpBox && cdpBox.x > 0 && cdpBox.y > 0) {
            finalCoord = {
              x: cdpBox.x,
              y: cdpBox.y,
              source: 'cdp-native-shadow-box',
            };
          }
        }

        if (finalCoord && finalCoord.x > 0 && finalCoord.y > 0) {
          await tracer.track(`🖱️ 正在通过 CDP 真实物理鼠标点击【发布】按钮 (坐标: ${finalCoord.x}, ${finalCoord.y}, 来源: ${finalCoord.source})...`);
          await client.mouseClick(finalCoord.x, finalCoord.y, { delayMs: 120 });
        } else {
          await tracer.updateStep(5, 'error');
          await tracer.track('❌ 未能定位到小红书【发布】按钮坐标，无法自动发布！', null, 'error', { persistent: true });
          return {
            success: false,
            platform: 'xiaohongshu',
            message: this.formatLog('未能定位到小红书【发布】按钮，发布未完成', activeLang),
          };
        }

        // 点击发布后等待 1.5 秒，检测并处理可能弹出的二次确认对话框（如“确认发布” / “继续发布” / “确定”）
        await sleep(1500, signal);
        const confirmDialog = await client.evaluate(() => {
          const isVisible = (el: HTMLElement | null): boolean => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };

          const modals = Array.from(document.querySelectorAll('.creator-modal-style, .d-modal, [class*="modal"], [role="dialog"]')) as HTMLElement[];
          const activeModal = modals.find((m) => isVisible(m));
          if (!activeModal) return null;

          const btns = Array.from(activeModal.querySelectorAll('button, .d-button, [role="button"]')) as HTMLElement[];
          const targetBtn = btns.find((b) => {
            const txt = (b.textContent || '').trim();
            return ['确认发布', '继续发布', '确认', '确定', '我知道了'].includes(txt);
          });

          if (targetBtn && isVisible(targetBtn)) {
            const r = targetBtn.getBoundingClientRect();
            return {
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
              text: (targetBtn.textContent || '').trim(),
            };
          }
          return null;
        }).catch(() => null);

        if (confirmDialog && confirmDialog.x && confirmDialog.y) {
          await tracer.track(`[二次确认] 检测到发布确认弹窗，正在物理点击【${confirmDialog.text}】按钮...`);
          await client.mouseClick(confirmDialog.x, confirmDialog.y, { delayMs: 120 });
          await sleep(1000, signal);
        }

        // 注入发布接口轻量透明监听器（用于 100% 精准捕获小红书后端真实返回结果）
        await client.evaluate(() => {
          if ((window as any).__xhs_publish_interceptor_installed__) return;
          (window as any).__xhs_publish_interceptor_installed__ = true;
          (window as any).__xhs_publish_state__ = { status: 'idle', time: 0, code: null, msg: '' };

          try {
            const origFetch = window.fetch;
            window.fetch = async function(...args) {
              const res = await origFetch.apply(this, args);
              try {
                const url = typeof args[0] === 'string' ? args[0] : ((args[0] as any)?.url || '');
                if (url.includes('/publish') || url.includes('/post') || url.includes('/item/video') || url.includes('/item/note') || url.includes('/creator/note')) {
                  const clone = res.clone();
                  clone.json().then((data: any) => {
                    if (data && (data.code === 0 || data.success === true || data.data?.note_id || data.data?.id)) {
                      (window as any).__xhs_publish_state__ = { status: 'success', time: Date.now(), data };
                    } else if (data && typeof data.code === 'number' && data.code !== 0) {
                      (window as any).__xhs_publish_state__ = { status: 'error', time: Date.now(), msg: data.msg || data.message || '发布接口返回异常' };
                    }
                  }).catch(() => {});
                }
              } catch (e) {}
              return res;
            };

            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method: string, url: string) {
              (this as any).__xhr_url = url;
              return origOpen.apply(this, arguments as any);
            };
            XMLHttpRequest.prototype.send = function() {
              this.addEventListener('load', function() {
                try {
                  const url = (this as any).__xhr_url || '';
                  if (url.includes('/publish') || url.includes('/post') || url.includes('/item/video') || url.includes('/item/note') || url.includes('/creator/note')) {
                    const data = JSON.parse(this.responseText);
                    if (data && (data.code === 0 || data.success === true || data.data?.note_id || data.data?.id)) {
                      (window as any).__xhs_publish_state__ = { status: 'success', time: Date.now(), data };
                    } else if (data && typeof data.code === 'number' && data.code !== 0) {
                      (window as any).__xhs_publish_state__ = { status: 'error', time: Date.now(), msg: data.msg || data.message || '发布接口返回异常' };
                    }
                  }
                } catch (e) {}
              });
              return origSend.apply(this, arguments as any);
            };
          } catch (e) {}
        }).catch(() => {});

        // 严谨状态轮询：等待小红书发布完成（支持定时发布与即时发布），严格检测页面错误与成功反馈
        let publishSuccessConfirmed = false;
        let publishErrorMessage = '';
        let hasRetriedClick = false;

        for (let check = 0; check < 25; check++) {
          await sleep(1000, signal);
          if (signal.aborted || adapter.isClosed() || tracer.isAborted()) {
            throw new PublishAbortedError(this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }), activeLang);
          }

          const publishCheck = await client.evaluate(() => {
            const curUrl = window.location.href;

            // 穿透 Shadow DOM 的全页面文本提取函数
            const walkAllText = (root: Node): string => {
              let text = '';
              if (!root) return text;
              if (root.nodeType === Node.TEXT_NODE) {
                return (root.textContent || '').trim() + ' ';
              }
              const el = root as HTMLElement;
              if (el.shadowRoot) {
                text += walkAllText(el.shadowRoot) + ' ';
              }
              const children = el.childNodes || [];
              for (let i = 0; i < children.length; i++) {
                text += walkAllText(children[i]);
              }
              return text;
            };

            const bodyText = (document.body ? (document.body.innerText || '') : '');
            const combinedText = bodyText + ' ' + walkAllText(document.body);

            const isVisible = (el: HTMLElement | null): boolean => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            };

            // 0. 网络拦截器直接凭据（若小红书后端接口已明确返回成功）
            const netState = (window as any).__xhs_publish_state__;
            const isNetworkSuccess = Boolean(netState && netState.status === 'success');
            const isNetworkError = Boolean(netState && netState.status === 'error');
            const networkErrorMsg = netState?.msg || '';

            // 1. 精准检测可见的表单错误提示（红字校验）
            const errorSelectors = [
              '.d-form-item-explain-error',
              '.ant-form-item-explain-error',
              '.error-message',
              '.error-tip',
              '.input-error',
              '.toast-error',
              '[class*="error-text"]',
              '[class*="form-error"]',
              '[class*="toast-item-error"]',
              '.dyn-form-item-error',
            ];
            const errorNodes = Array.from(document.querySelectorAll(errorSelectors.join(', '))) as HTMLElement[];
            const visibleErrorTexts = errorNodes
              .filter((el) => isVisible(el))
              .map((el) => (el.textContent || '').trim())
              .filter((t) => t.length > 0 && !t.includes('成功'));

            // 2. 检测当前活跃可见的 Toast / Message / 浮层提示
            const toastNodes = Array.from(
              document.querySelectorAll('.d-toast, .ant-message-notice, [class*="toast"], [class*="message-notice"], [role="alert"], .d-notification, .ant-notification')
            ) as HTMLElement[];
            const visibleToasts = toastNodes.filter((el) => isVisible(el));

            let toastError = '';
            let toastSuccess = false;
            for (const toast of visibleToasts) {
              const tText = (toast.textContent || '').trim();
              const tHtml = toast.innerHTML || '';
              const isErrorType = tHtml.includes('error') || tHtml.includes('fail') || /失败|违规|超限|不可|异常|请重新/.test(tText);
              const isSuccessType = /成功|发表成功|发布成功|已提交|已设置|已排期|定时成功|发布完成|已发布/.test(tText);

              if (isSuccessType && !isErrorType) {
                toastSuccess = true;
              } else if (isErrorType && !isSuccessType) {
                toastError = tText;
              }
            }

            // 3. 检测阻断性弹窗（排除正常的“确认发布/继续发布”弹窗）
            const modalNodes = Array.from(
              document.querySelectorAll('.creator-modal-style, .d-modal, [class*="modal"], [role="dialog"]')
            ) as HTMLElement[];
            const activeModals = modalNodes.filter((m) => isVisible(m));
            let modalError = '';
            for (const modal of activeModals) {
              const mText = (modal.textContent || '').trim();
              if (/(发布失败|包含违规|账号异常|已被封禁|格式不支持|文件损坏|请上传封面)/.test(mText)) {
                modalError = mText.slice(0, 100);
                break;
              }
            }

            // 全局文本关键词报错排查
            const errorKeywords = [
              '发布失败',
              '发表失败',
              '包含违规',
              '账号异常',
              '已被封禁',
              '已被限制',
              '格式不支持',
              '文件损坏',
              '请上传封面',
              '请修改错误',
              '操作过于频繁',
              '系统繁忙',
            ];
            let matchedErrorKeyword = '';
            for (const ekw of errorKeywords) {
              if (combinedText.includes(ekw)) {
                matchedErrorKeyword = ekw;
                break;
              }
            }

            const hasError = isNetworkError || visibleErrorTexts.length > 0 || Boolean(toastError) || Boolean(modalError) || Boolean(matchedErrorKeyword);
            const errorDetail = isNetworkError
              ? networkErrorMsg
              : (visibleErrorTexts.length > 0
                ? visibleErrorTexts.join('；')
                : (toastError || modalError || matchedErrorKeyword));

            // 4. 成功特征匹配（多维度覆盖）：
            // a) URL 路由发生跳转（离开单纯的发布页或进入内容列表/首页/管理页）
            const isLeftPublishPage = !curUrl.includes('/publish/publish') ||
              curUrl.includes('/creator/notes') ||
              curUrl.includes('/creator/post') ||
              curUrl.includes('/new/home') ||
              curUrl.includes('/creator/home') ||
              curUrl.includes('/creator/published') ||
              curUrl.includes('/creator/manage') ||
              curUrl.includes('/manage/post') ||
              curUrl.includes('publish_success') ||
              curUrl.includes('tab=manage') ||
              curUrl.includes('tab=notes');

            // b) 页面中或 Shadow DOM 中出现了发布成功的关键字
            const successKeywords = [
              '发布成功',
              '发表成功',
              '笔记发布成功',
              '视频发布成功',
              '定时发布成功',
              '定时发表成功',
              '已定时发表',
              '已定时发布',
              '定时成功',
              '已发布',
              '发布完成',
              '发表完成',
              '已提交审核',
              '提交审核成功',
              '审核中',
              '已提交',
              '已排期',
              '已成功设置',
              '查看笔记',
              '继续发布',
              '再发一篇',
              '再发一条',
              '发布下一篇',
              '管理笔记',
              '作品管理',
              '内容管理',
              '笔记管理',
              '返回笔记列表',
              '去电脑端查看',
            ];
            let matchedSuccessKeyword = '';
            for (const kw of successKeywords) {
              if (combinedText.includes(kw)) {
                matchedSuccessKeyword = kw;
                break;
              }
            }

            // c) 页面中出现了发布成功的卡片容器、成功图标或按钮
            const successDomFound = Boolean(
              matchedSuccessKeyword ||
              document.querySelector(
                '.publish-success, [class*="publish-success"], [class*="publishSuccess"], [class*="success-container"], [class*="success-box"], .d-result-success, .ant-result-success, [class*="success-wrapper"]'
              ) ||
              Array.from(document.querySelectorAll('button, a, .d-button, span, div')).some((el: any) => {
                const txt = (el.textContent || '').trim();
                return isVisible(el) && (txt.includes('查看笔记') || txt.includes('继续发布') || txt.includes('发布下一篇') || txt.includes('返回首页') || txt.includes('管理笔记') || txt.includes('发布成功') || txt.includes('定时成功'));
              })
            );

            // d) 表单重置特征：发布提交后，视频预览消失，页面恢复为待上传状态且无任何红字错误
            const isInitialUploadForm = Boolean(
              (combinedText.includes('拖拽视频到此处') || combinedText.includes('点击上传视频') || combinedText.includes('上传时长')) &&
              !document.querySelector('video')
            );

            // 5. 检查发布按钮自身的加载状态与禁用状态
            const xhsHost = document.querySelector('xhs-publish-btn') as HTMLElement | null;
            const isSubmitLoading = Boolean(xhsHost && xhsHost.getAttribute('submit-loading') === 'true');
            const isSubmitDisabled = Boolean(xhsHost && xhsHost.getAttribute('submit-disabled') === 'true');

            const hasConfirmedSuccess = Boolean(
              isNetworkSuccess ||
              isLeftPublishPage ||
              toastSuccess ||
              successDomFound ||
              (isInitialUploadForm && !isSubmitLoading)
            );

            return {
              hasSuccess: hasConfirmedSuccess && !hasError,
              hasError,
              errorDetail,
              isSubmitLoading,
              isSubmitDisabled,
              curUrl,
              matchedSuccessKeyword,
              isNetworkSuccess,
            };
          }).catch(() => null);

          // 一旦检测到明确的异常错误信息提示，立即判定为发布失败
          if (publishCheck?.hasError) {
            publishErrorMessage = publishCheck.errorDetail || '小红书页面检测到表单或提交异常提示';
            await tracer.track(`❌ 小红书发布遇到异常提示: ${publishErrorMessage}`, null, 'error', { persistent: true });
            publishSuccessConfirmed = false;
            break;
          }

          // 确认检测到发布成功标识（网络接口成功 / DOM 成功文案 / URL 路由成功）且无任何错误
          if (publishCheck?.hasSuccess) {
            publishSuccessConfirmed = true;
            if (publishCheck.matchedSuccessKeyword) {
              await tracer.track(`✅ 确认小红书发布成功提示: "${publishCheck.matchedSuccessKeyword}"`, null, 'success');
            } else if (publishCheck.isNetworkSuccess) {
              await tracer.track('✅ 小红书发布 API 接口已成功返回确认 code: 0！', null, 'success');
            }
            break;
          }

          if (publishCheck?.isSubmitLoading) {
            await tracer.track('⏳ 小红书正在提交视频素材与发布数据中...', null, 'info');
          }

          // 如果经过 8 秒仍未成功且无 loading、无网络响应，进行一次补充点击重试
          if (check === 8 && !publishCheck?.isSubmitLoading && !hasRetriedClick && finalCoord) {
            hasRetriedClick = true;
            await tracer.track('ℹ️ 正在补充触发一次发布按钮点击确认...');
            await client.mouseClick(finalCoord.x, finalCoord.y, { delayMs: 150 });
          }
        }

        // 终极保底检查（防止循环结束瞬间刚刚完成渲染或已跳转）
        if (!publishSuccessConfirmed && !publishErrorMessage) {
          const finalCheck = await client.evaluate(() => {
            const bodyText = document.body ? (document.body.innerText || '') : '';
            const curUrl = window.location.href;
            const netState = (window as any).__xhs_publish_state__;
            const isNetOk = Boolean(netState && netState.status === 'success');
            const hasSuccessWord = /(发布成功|发表成功|笔记发布成功|定时成功|已发布|已提交|查看笔记|继续发布|作品管理|内容管理)/.test(bodyText);
            const isLeftPage = !curUrl.includes('/publish/publish');
            const hasErrorWord = /(发布失败|包含违规|已被封禁|已被限制)/.test(bodyText);
            return {
              isSuccess: (isNetOk || hasSuccessWord || isLeftPage) && !hasErrorWord,
              bodySample: bodyText.slice(0, 150),
            };
          }).catch(() => null);

          if (finalCheck?.isSuccess) {
            publishSuccessConfirmed = true;
            await tracer.track('✅ 终极状态核验确认小红书已成功提交发布！', null, 'success');
          }
        }

        // 仅当明确确认发布成功且没有任何异常信息提示时，才返回 success: true
        if (publishSuccessConfirmed && !publishErrorMessage) {
          await tracer.updateStep(5, 'done');
          await tracer.track(this.t('publishSuccessDetected', activeLang, { platform: this.getDisplayName(activeLang) }), null, 'success');
          return {
            success: true,
            platform: 'xiaohongshu',
            message: this.t('publishSuccess', activeLang, { platform: this.getDisplayName(activeLang) }),
          };
        } else {
          // 有异常提示或未确认发布成功——绝不标记为已发布
          await tracer.updateStep(5, 'error');
          const finalMsg = publishErrorMessage || this.t('publishTimeout', activeLang);
          await tracer.track(`⚠️ ${finalMsg}`, null, 'warn', { persistent: true });
          return {
            success: false,
            platform: 'xiaohongshu',
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
          platform: 'xiaohongshu',
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
      platform: 'xiaohongshu',
      message: 'Form filled, awaiting manual confirmation',
    };
    } catch (err: any) {
      if (err?.isAborted || err?.name === 'PublishAbortedError' || signal.aborted || adapter.isClosed()) {
        console.warn(`[ShortVideo ${this.getDisplayName()}] Aborted: ${err.message}`);
        return {
          success: false,
          platform: 'xiaohongshu',
          message: err.message || this.t('tabClosed', activeLang, { platform: this.getDisplayName(activeLang) }),
        };
      }
      throw err;
    } finally {
      if (this.currentAbortController?.signal === signal) {
        this.currentAbortController = null;
      }
      if (client) {
        try { client.close(); } catch {}
      }
    }
  }
}
