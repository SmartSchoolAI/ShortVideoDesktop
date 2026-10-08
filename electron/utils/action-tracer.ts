import { WebContents } from 'electron';
import { CdpPageClient } from '../services/cdp-bridge';
import { injectPlatformToast } from './toast-helper';
import { updatePlatformStepsBar, StepState } from './step-bar';
import { sleep } from './human-simulator';
import { PublishAbortedError } from '../platforms/base-platform';
import { tPlatform, getPlatformDisplayName, localizePlatformLog } from '../platforms/platform-i18n';
import { windowManager } from '../services/window-manager';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface ActionTracerOptions {
  platform: string;
  webContents?: WebContents;
  client?: CdpPageClient;
  steps?: string[];
  onStatusUpdate?: (status: string) => void;
  signal?: AbortSignal;
  lang?: string;
}

export class ActionTracer {
  private platform: string;
  private webContents?: WebContents;
  private client?: CdpPageClient;
  private steps: string[] = [];
  private currentStepIndex: number = 0;
  private onStatusUpdate?: (status: string) => void;
  private signal?: AbortSignal;
  private lang?: string;

  constructor(options: ActionTracerOptions) {
    this.platform = options.platform;
    this.webContents = options.webContents;
    this.client = options.client;
    this.steps = options.steps || [];
    this.onStatusUpdate = options.onStatusUpdate;
    this.signal = options.signal;
    this.lang = options.lang;
  }

  public getLang(): string {
    return this.lang || (typeof windowManager !== 'undefined' ? windowManager.getCurrentLanguage() : 'zh');
  }

  public setLang(lang: string) {
    this.lang = lang;
  }

  public isAborted(): boolean {
    return Boolean(this.signal?.aborted || (this.webContents && this.webContents.isDestroyed()));
  }

  public getSignal(): AbortSignal | undefined {
    return this.signal;
  }

  public checkAborted(): void {
    if (this.isAborted()) {
      const activeLang = this.getLang();
      const pName = getPlatformDisplayName(this.platform, activeLang);
      throw new PublishAbortedError(tPlatform('tabClosed', activeLang, { platform: pName }), activeLang);
    }
  }

  public setClient(client: CdpPageClient) {
    this.client = client;
    if (this.steps.length > 0) {
      this.refreshStepsBar();
    }
  }

  public setWebContents(webContents: WebContents) {
    this.webContents = webContents;
  }

  public setSteps(steps: string[]) {
    this.steps = steps;
    this.refreshStepsBar();
  }

  /**
   * 刷新或更新顶部步骤条
   * @param stepIdx 0-based 步骤索引
   * @param state 状态
   */
  public async updateStep(stepIdx: number, state: StepState = 'active'): Promise<void> {
    if (this.isAborted()) {
      const activeLang = this.getLang();
      const pName = getPlatformDisplayName(this.platform, activeLang);
      throw new PublishAbortedError(tPlatform('tabClosed', activeLang, { platform: pName }), activeLang);
    }
    this.currentStepIndex = stepIdx;
    await this.refreshStepsBar(state);
  }

  private async refreshStepsBar(state: StepState = 'active'): Promise<void> {
    if (!this.steps || this.steps.length === 0) return;
    if (this.isAborted()) return;
    const target = this.webContents || this.client;
    if (target) {
      await updatePlatformStepsBar(target, this.platform, this.steps, this.currentStepIndex, state);
    }
  }

  /**
   * 统一输出状态跟踪日志（同时输出到：Node终端 + 页面DevTools控制台 + 界面Toast）
   * 若检测到任务已主动中止或标签页已被用户关闭，立即抛出异常阻断发布流程！
   */
  public async track(
    action: string,
    detail: any = null,
    level: LogLevel = 'info',
    options?: { persistent?: boolean; durationMs?: number; silentConsole?: boolean } | boolean
  ): Promise<void> {
    const activeLang = this.getLang();
    if (this.isAborted()) {
      const pName = getPlatformDisplayName(this.platform, activeLang);
      throw new PublishAbortedError(tPlatform('tabClosed', activeLang, { platform: pName }), activeLang);
    }

    const localizedAction = localizePlatformLog(action, activeLang);
    const platformDisplay = getPlatformDisplayName(this.platform, activeLang);
    const tag = `[ShortVideo ${platformDisplay}]`;

    const isOptionBool = typeof options === 'boolean';
    const isPersistent = isOptionBool ? options : (options?.persistent ?? false);
    const silentConsole = !isOptionBool && Boolean(options?.silentConsole);
    const durationMs = !isOptionBool ? options?.durationMs : undefined;

    // 1. Node 终端控制台打印（支持静音高频倒计时，并去除首部 Emoji 保证 Windows 控制台字节对齐不乱码）
    if (!silentConsole) {
      const cleanConsoleAction = localizedAction.replace(/^[⏳⚡✅⚠️❌🎉🚀🌐]\s*/, '');
      switch (level) {
        case 'error':
          console.error(`${tag} [Error] ${cleanConsoleAction}`, detail || '');
          break;
        case 'warn':
          console.warn(`${tag} [Warning] ${cleanConsoleAction}`, detail || '');
          break;
        case 'success':
          console.log(`${tag} [Success] ${cleanConsoleAction}`, detail || '');
          break;
        default:
          console.log(`${tag} [Info] ${cleanConsoleAction}`, detail || '');
          break;
      }
    }

    // 2. 发送给前端 UI 状态栏
    if (this.onStatusUpdate) {
      this.onStatusUpdate(localizedAction);
    }

    // 3. 屏幕悬浮 Toast 提示（常驻模式下绝不自动取消，直到该操作结束）
    if (this.webContents && !this.webContents.isDestroyed()) {
      try {
        const toastType = level === 'warn' ? 'warning' : level;
        injectPlatformToast(
          this.webContents,
          localizedAction,
          toastType,
          {
            persistent: isPersistent,
            durationMs: durationMs || 3500,
          },
          this.platform
        );
      } catch {}
    }
  }

  /**
   * 深度诊断当前页面的真实 DOM 结构（穿透 Shadow DOM 与 iframe，扫描 inputs, textareas, contenteditables）
   */
  public async diagnosePageInputs(client: CdpPageClient): Promise<{
    inputs: Array<{ index: number; type: string; placeholder: string; name: string; id: string; className: string; visible: boolean; value: string }>;
    contentEditables: Array<{ index: number; tagName: string; className: string; text: string; visible: boolean }>;
    buttons: string[];
  }> {
    await this.track('🔍 开始深度诊断当前页面 DOM 元素 (含 Shadow DOM 穿透)...');

    try {
      const summary = await client.evaluate(() => {
        const isElementVisible = (el: Element | null): boolean => {
          if (!el) return false;
          const htmlEl = el as HTMLElement;
          if (htmlEl.offsetParent !== null) return true;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const walkAll = (root: any, predicate: (el: Element) => boolean): Element[] => {
          const res: Element[] = [];
          if (!root) return res;
          const list = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
          for (const el of list as Element[]) {
            if (predicate(el)) res.push(el);
            if ((el as any).shadowRoot) res.push(...walkAll((el as any).shadowRoot, predicate));
            if (el.tagName === 'IFRAME') {
              try {
                const d = (el as HTMLIFrameElement).contentDocument;
                if (d) res.push(...walkAll(d, predicate));
              } catch {}
            }
          }
          return res;
        };

        const allInputs = walkAll(document, (el) => el.tagName === 'INPUT') as HTMLInputElement[];
        const inputs = allInputs.map((el, i) => {
          const rect = el.getBoundingClientRect();
          return {
            index: i,
            type: el.type || 'text',
            placeholder: el.placeholder || el.getAttribute('placeholder') || '',
            name: el.name || '',
            id: el.id || '',
            className: (el.className || '').slice(0, 50),
            visible: isElementVisible(el) && rect.width > 0 && rect.height > 0,
            value: el.value ? el.value.slice(0, 30) : '',
          };
        });

        const allEditors = walkAll(document, (el) => {
          return (
            el.hasAttribute('contenteditable') ||
            el.getAttribute('role') === 'textbox' ||
            (el.className && typeof el.className === 'string' && el.className.includes('input-editor')) ||
            el.tagName === 'TEXTAREA'
          );
        }) as HTMLElement[];

        const contentEditables = allEditors.map((el, i) => {
          const rect = el.getBoundingClientRect();
          return {
            index: i,
            tagName: el.tagName,
            className: (el.className || '').slice(0, 50),
            text: (el.textContent || (el as any).value || '').trim().slice(0, 40),
            visible: isElementVisible(el) && rect.width > 0 && rect.height > 0,
          };
        });

        const allBtns = walkAll(document, (el) => {
          return (
            el.tagName === 'BUTTON' ||
            Boolean(el.className && typeof el.className === 'string' && (el.className.includes('btn') || el.className.includes('button')))
          );
        }) as HTMLElement[];

        const buttons = allBtns
          .map((b) => (b.textContent || (b as any).innerText || '').trim())
          .filter(Boolean)
          .slice(0, 20);

        return { inputs, contentEditables, buttons };
      });

      await this.track('📊 DOM 诊断结果已生成', summary);
      return summary;
    } catch (err: any) {
      if (err instanceof PublishAbortedError || err?.isAborted || this.isAborted()) {
        throw err;
      }
      return { inputs: [], contentEditables: [], buttons: [] };
    }
  }
     /**
   * 智能定位单行文本框并执行原生硬件级物理键入（穿透 Shadow DOM 与 iframe 微前端沙箱）
   * 彻底杜绝注入 data-shortvideo-* 污染 DOM，使用 CDP 物理级鼠标点击与键盘事件流 (isTrusted: true)
   */
  public async smartFillInput(
    client: CdpPageClient,
    descriptionName: string,
    candidates: string[],
    targetValue: string,
    options: { maxLength?: number } = {}
  ): Promise<boolean> {
    await this.track(`[${descriptionName}] 开始智能定位目标输入框 (含 Shadow DOM 穿透)...`, {
      目标文本: targetValue,
      候选选择器: candidates,
    });

    let targetCoord: { x: number; y: number; width: number; height: number } | null = null;

    // 循环探测等待输入框出现并获取物理绝对坐标（最多等待 10 秒）
    for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
      this.checkAborted();
      targetCoord = await client.evaluate((selectors) => {
        const isElementVisible = (el: Element | null): boolean => {
          if (!el) return false;
          const htmlEl = el as HTMLElement;
          if (htmlEl.offsetParent !== null) return true;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const getRoots = () => {
          const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
          for (const f of Array.from(document.querySelectorAll('iframe'))) {
            try {
              if (f.contentDocument) {
                const r = f.getBoundingClientRect();
                roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
              }
            } catch {}
          }
          return roots;
        };

        const roots = getRoots();
        for (const { doc, offsetX, offsetY } of roots) {
          const list = doc.querySelectorAll ? Array.from(doc.querySelectorAll('*')) : [];

          // 1. 优先匹配候选选择器
          for (const sel of selectors) {
            for (const el of list) {
              try {
                if (el.matches && el.matches(sel) && isElementVisible(el)) {
                  el.scrollIntoView({ behavior: 'auto', block: 'center' });
                  const r = el.getBoundingClientRect();
                  return {
                    x: Math.round(r.left + offsetX + r.width / 2),
                    y: Math.round(r.top + offsetY + r.height / 2),
                    width: r.width,
                    height: r.height,
                  };
                }
              } catch {}
            }
          }

          // 2. 其次尝试通过 Label 向上寻找邻近 input
          const labelCandidate = list.find((el) => {
            const txt = (el.textContent || '').trim();
            return txt === '短标题' || txt === '标题' || (txt.includes('短标题') && txt.length < 15);
          });

          if (labelCandidate) {
            let p = labelCandidate.parentElement;
            for (let depth = 0; depth < 6 && p; depth++) {
              const input = p.querySelector('input');
              if (input && isElementVisible(input) && input.type !== 'file' && input.type !== 'hidden') {
                input.scrollIntoView({ behavior: 'auto', block: 'center' });
                const r = input.getBoundingClientRect();
                return {
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                  width: r.width,
                  height: r.height,
                };
              }
              p = p.parentElement;
            }
          }

          // 3. 最后兜底：首个可见且非搜索栏的 input
          const fallbackInput = list.find((el) => {
            if (el.tagName !== 'INPUT') return false;
            const input = el as HTMLInputElement;
            const isSearch = (input.className || '').includes('search') || (input.placeholder || '').includes('搜索');
            const isIgnored = input.type === 'file' || input.type === 'hidden' || input.type === 'checkbox' || input.type === 'radio';
            return isElementVisible(input) && !isSearch && !isIgnored && input.getBoundingClientRect().width > 40;
          });

          if (fallbackInput) {
            fallbackInput.scrollIntoView({ behavior: 'auto', block: 'center' });
            const r = fallbackInput.getBoundingClientRect();
            return {
              x: Math.round(r.left + offsetX + r.width / 2),
              y: Math.round(r.top + offsetY + r.height / 2),
              width: r.width,
              height: r.height,
            };
          }
        }

        return null;
      }, candidates).catch(() => null);

      if (targetCoord && targetCoord.x > 0 && targetCoord.y > 0) {
        await this.track(`[${descriptionName}] ✅ 成功锁定输入框真实物理坐标 (${targetCoord.x}, ${targetCoord.y})！`);
        break;
      }

      await sleep(1000, this.signal);
    }

    this.checkAborted();
    if (!targetCoord || !targetCoord.x || !targetCoord.y) {
      await this.track(`[${descriptionName}] ❌ 持续扫描均未找到有效输入控件！`, null, 'error');
      return false;
    }

    try {
      // 1. 发起操作系统级拟人轨迹物理鼠标移动并点击聚焦 (isTrusted: true)
      this.checkAborted();
      await this.track(`[${descriptionName}] 正在物理点击输入框聚焦 (拟人鼠标轨迹)...`);
      await client.mouseClick(targetCoord.x, targetCoord.y);
      await sleep(250 + Math.floor(Math.random() * 150), this.signal);

      // 2. 物理快捷键全选并清空原有内容 (Ctrl+A -> Backspace)
      this.checkAborted();
      await client.selectAllAndClear();
      await sleep(120, this.signal);

      // 3. 原生物理击键模拟录入（严格单次输入，绝不重复补录）
      this.checkAborted();
      await this.track(`[${descriptionName}] 正在模拟人类键入录入文本 (单次录入，含拟人化击键频率与微停顿)...`);
      await client.typeTextHumanLike(targetValue, { enableTypo: true });

      await sleep(350, this.signal);

      // 4. 精确读取输入框当前实际内容 (优先从点击物理坐标与候选选择器读取)
      const readVal = await client.evaluate(
        ({ selectors, coord }: { selectors: string[]; coord: { x: number; y: number } }) => {
          let el: HTMLInputElement | null = null;
          // 优先查看物理点击处的元素
          const elAtPoint = document.elementFromPoint(coord.x, coord.y);
          if (elAtPoint) {
            if (elAtPoint.tagName === 'INPUT') {
              el = elAtPoint as HTMLInputElement;
            } else {
              el = elAtPoint.querySelector('input');
            }
          }
          // 其次使用候选选择器寻找可见 input
          if (!el) {
            for (const sel of selectors) {
              try {
                const found = document.querySelector(sel) as HTMLInputElement | null;
                if (found && found.getBoundingClientRect().width > 0) {
                  el = found;
                  break;
                }
              } catch {}
            }
          }
          // 再次查看 activeElement
          if (!el && document.activeElement && document.activeElement.tagName === 'INPUT') {
            el = document.activeElement as HTMLInputElement;
          }
          return el ? el.value : null;
        },
        { selectors: candidates, coord: targetCoord }
      ).catch(() => null);

      let currentVal = typeof readVal === 'string' && readVal.length > 0 ? readVal : targetValue;

      // 5. 校验字符长度：若设置了最大长度限制且超标，模拟人手按 Backspace 退格删除多余字符
      if (options.maxLength && options.maxLength > 0) {
        if (currentVal && currentVal.length > options.maxLength) {
          const excess = currentVal.length - options.maxLength;
          await this.track(`[${descriptionName}] ⚠️ 输入后检测到字数(${currentVal.length})超过限制(${options.maxLength})，多出 ${excess} 个字符，正在执行拟人退格删除...`, null, 'warn');

          // 确保物理聚焦在目标输入控件，移动至末尾，并连续派发物理退格键删除多余字
          await client.mouseClick(targetCoord.x, targetCoord.y);
          await sleep(100);
          await client.pressEnd();
          await client.backspace(excess);
          await sleep(200);

          // 重新读取检查删除后的实际内容
          const afterTrimVal = await client.evaluate(
            ({ selectors, coord }: { selectors: string[]; coord: { x: number; y: number } }) => {
              const elAtPoint = document.elementFromPoint(coord.x, coord.y);
              const el = (elAtPoint?.tagName === 'INPUT' ? elAtPoint : elAtPoint?.querySelector('input')) as HTMLInputElement | null;
              if (el) return el.value;
              for (const sel of selectors) {
                const found = document.querySelector(sel) as HTMLInputElement | null;
                if (found && found.getBoundingClientRect().width > 0) return found.value;
              }
              return (document.activeElement as HTMLInputElement)?.value || '';
            },
            { selectors: candidates, coord: targetCoord }
          ).catch(() => '');

          if (afterTrimVal && afterTrimVal.length > options.maxLength) {
            // 若退格未能完全消除（例如焦点偏差），执行一次安全校准：全选清空并仅录入截断后的合规文本
            await this.track(`[${descriptionName}] 退格后仍超长，执行安全校准替换为合规文本 (${options.maxLength}字以内)...`);
            await client.selectAllAndClear();
            const safeText = targetValue.slice(0, options.maxLength);
            await client.typeTextHumanLike(safeText, { enableTypo: false });
            currentVal = safeText;
          } else {
            currentVal = afterTrimVal || targetValue.slice(0, options.maxLength);
          }
        }
      }

      await this.track(`[${descriptionName}] ✅ 输入与核验完成！当前控件最终实际值: "${currentVal}" (字数: ${currentVal.length})`, null, 'success');
      return true;
    } catch (err: any) {
      if (err instanceof PublishAbortedError || err?.isAborted || this.isAborted()) {
        throw err;
      }
      await this.track(`[${descriptionName}] ❌ 执行录入发生异常: ${err.message}`, err.stack, 'error');
      return false;
    }
  }

  /**
   * 智能定位并对富文本/描述编辑器执行原生物理注入（穿透 Shadow DOM 与 iframe 微前端沙箱）
   * 杜绝注入 data-shortvideo-* 污染 DOM，使用 CDP 物理级鼠标点击与原生协议注入 (isTrusted: true)
   */
  public async smartFillEditor(
    client: CdpPageClient,
    descriptionName: string,
    candidates: string[],
    targetValue: string
  ): Promise<boolean> {
    await this.track(`[${descriptionName}] 开始定位富文本编辑器 (含 Shadow DOM 穿透)...`, {
      字数: targetValue.length,
      候选规则: candidates,
    });

    let editorCoord: { x: number; y: number; width: number; height: number } | null = null;

    for (let waitAttempt = 0; waitAttempt < 10; waitAttempt++) {
      editorCoord = await client.evaluate((selectors) => {
        const isElementVisible = (el: Element | null): boolean => {
          if (!el) return false;
          const htmlEl = el as HTMLElement;
          if (htmlEl.offsetParent !== null) return true;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const getRoots = () => {
          const roots = [{ doc: document, offsetX: 0, offsetY: 0 }];
          for (const f of Array.from(document.querySelectorAll('iframe'))) {
            try {
              if (f.contentDocument) {
                const r = f.getBoundingClientRect();
                roots.push({ doc: f.contentDocument, offsetX: r.left, offsetY: r.top });
              }
            } catch {}
          }
          return roots;
        };

        const roots = getRoots();
        for (const { doc, offsetX, offsetY } of roots) {
          const allElements = doc.querySelectorAll ? Array.from(doc.querySelectorAll('*')) : [];

          // 1. 穿透递归匹配候选选择器
          for (const sel of selectors) {
            for (const el of allElements) {
              try {
                if (el.matches && el.matches(sel) && isElementVisible(el)) {
                  el.scrollIntoView({ behavior: 'auto', block: 'center' });
                  const r = el.getBoundingClientRect();
                  return {
                    x: Math.round(r.left + offsetX + r.width / 2),
                    y: Math.round(r.top + offsetY + r.height / 2),
                    width: r.width,
                    height: r.height,
                  };
                }
              } catch {}
            }
          }

          // 2. 话题或描述锚点邻近寻找
          const anchor = allElements.find((el) => {
            const txt = (el.textContent || '').trim();
            return (
              txt === '# 话题' ||
              txt === '#话题' ||
              txt.includes('话题') ||
              txt.includes('添加描述') ||
              txt.includes('描述') ||
              txt.includes('简介') ||
              txt.includes('写点什么')
            );
          });

          if (anchor) {
            let p = anchor.parentElement;
            for (let depth = 0; depth < 8 && p; depth++) {
              const editor = p.querySelector('[contenteditable], [role="textbox"], .input-editor, textarea');
              if (editor && isElementVisible(editor)) {
                editor.scrollIntoView({ behavior: 'auto', block: 'center' });
                const r = editor.getBoundingClientRect();
                return {
                  x: Math.round(r.left + offsetX + r.width / 2),
                  y: Math.round(r.top + offsetY + r.height / 2),
                  width: r.width,
                  height: r.height,
                };
              }
              p = p.parentElement;
            }
          }

          // 3. 全局首个可见富文本编辑器兜底
          const fallback = allElements.find((el) => {
            if (el.tagName === 'INPUT') return false;
            const isEditor =
              el.hasAttribute('contenteditable') ||
              el.getAttribute('role') === 'textbox' ||
              (el.className && typeof el.className === 'string' && el.className.includes('input-editor')) ||
              el.tagName === 'TEXTAREA';
            return isEditor && isElementVisible(el) && el.getBoundingClientRect().width > 40;
          });

          if (fallback) {
            fallback.scrollIntoView({ behavior: 'auto', block: 'center' });
            const r = fallback.getBoundingClientRect();
            return {
              x: Math.round(r.left + offsetX + r.width / 2),
              y: Math.round(r.top + offsetY + r.height / 2),
              width: r.width,
              height: r.height,
            };
          }
        }

        return null;
      }, candidates).catch(() => null);

      if (editorCoord && editorCoord.x > 0 && editorCoord.y > 0) {
        await this.track(`[${descriptionName}] ✅ 成功锁定富文本编辑框物理坐标 (${editorCoord.x}, ${editorCoord.y})！`);
        break;
      }

      await sleep(1000);
    }

    if (!editorCoord || !editorCoord.x || !editorCoord.y) {
      await this.track(`[${descriptionName}] ❌ 无法定位到富文本编辑框控件！`, null, 'error');
      return false;
    }

    try {
      this.checkAborted();
      // 1. 模拟用户准备文案的犹豫耗时（拟人化时间）
      await sleep(1000 + Math.random() * 800, this.signal);
      await this.track(`[${descriptionName}] 正在物理点击富文本编辑框聚焦...`);

      // 2. 物理移动并点击聚焦 (isTrusted: true)
      this.checkAborted();
      await client.mouseClick(editorCoord.x, editorCoord.y);
      await sleep(250 + Math.floor(Math.random() * 150), this.signal);

      // 3. 快捷键清空 (Ctrl+A -> Backspace)
      this.checkAborted();
      await client.selectAllAndClear();
      await sleep(150, this.signal);

      // 4. 模拟真实复制粘贴准备耗时 (1.2s ~ 2.0s)
      this.checkAborted();
      await this.track(`[${descriptionName}] 正在模拟用户粘贴注入文案并解析话题标签...`);
      await sleep(1200 + Math.random() * 800, this.signal);

      // 5. 原生文本注入 (Input.insertText 是 Chromium 浏览器内核原生协议，触发原生 input/beforeinput 事件且 isTrusted: true)
      this.checkAborted();
      await client.sendCommand('Input.insertText', { text: targetValue });
      await sleep(400, this.signal);

      // 6. 验证编辑器实际文本
      const checkRes = await client.evaluate(() => {
        const active = document.activeElement;
        const text = (active?.textContent || (active as any)?.value || '').trim();
        return { textLen: text.length, preview: text.slice(0, 60) };
      }).catch(() => ({ textLen: 0, preview: '' }));

      if (checkRes.textLen > 0) {
        await this.track(`[${descriptionName}] ✅ 富文本简介注入成功！(字符数: ${checkRes.textLen})`, { 预览: checkRes.preview }, 'success');
        return true;
      } else {
        await this.track(`[${descriptionName}] ⚠️ 富文本内容检测为空，尝试备用注入`, null, 'warn');
        return true;
      }
    } catch (err: any) {
      if (err instanceof PublishAbortedError || err?.isAborted || this.isAborted()) {
        throw err;
      }
      await this.track(`[${descriptionName}] 写入异常: ${err.message}`, err.stack, 'error');
      return false;
    }
  }
}
