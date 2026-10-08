import http from 'http';
import WebSocket from 'ws';
import { WebContents } from 'electron';
import { STEALTH_SCRIPT } from '../stealth/anti-detection';

export const DEFAULT_CDP_PORT = 8315;

export interface CdpTargetInfo {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/**
 * 轻量纯净的独立 Page 级 CDP 控制客户端
 * 直接连接目标 WebContents 对应的 CDP WebSocket 端口，秒级直连，杜绝 Browser 层死锁与超时
 */
export class CdpPageClient {
  private ws: WebSocket | null = null;
  private messageId: number = 1;
  private pendingCallbacks: Map<number, { resolve: (res: any) => void; reject: (err: any) => void }> = new Map();
  private eventListeners: Map<string, Set<(params: any) => void>> = new Map();
  public targetInfo: CdpTargetInfo;
  private isClosed: boolean = false;

  constructor(targetInfo: CdpTargetInfo) {
    this.targetInfo = targetInfo;
  }

  /**
   * 监听底层 CDP 事件（如 Page.fileChooserOpened）
   */
  public on(event: string, listener: (params: any) => void) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  public off(event: string, listener: (params: any) => void) {
    this.eventListeners.get(event)?.delete(listener);
  }

  /**
   * 建立 WebSocket 连接
   */
  public async connect(timeoutMs: number = 8000): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[CdpPageClient] 连接超时 (${timeoutMs}ms): ${this.targetInfo.webSocketDebuggerUrl}`));
      }, timeoutMs);

      try {
        this.ws = new WebSocket(this.targetInfo.webSocketDebuggerUrl);

        this.ws.on('open', () => {
          clearTimeout(timer);
          // 激活常用 CDP 域
          this.sendCommand('Page.enable').catch(() => {});
          this.sendCommand('DOM.enable').catch(() => {});
          this.sendCommand('Runtime.enable').catch(() => {});
          // 最底层防检测注入：确保 Chromium 在创建任何新文档的第一毫秒、任何网页 JS 运行前注入防爬指纹伪装
          this.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: STEALTH_SCRIPT }).catch(() => {});
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const msg = JSON.parse(data.toString());
            // 处理命令响应
            if (msg.id && this.pendingCallbacks.has(msg.id)) {
              const cb = this.pendingCallbacks.get(msg.id)!;
              this.pendingCallbacks.delete(msg.id);
              if (msg.error) {
                cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
              } else {
                cb.resolve(msg.result);
              }
            }
            // 处理事件分发
            if (msg.method && this.eventListeners.has(msg.method)) {
              for (const listener of this.eventListeners.get(msg.method)!) {
                try {
                  listener(msg.params);
                } catch {}
              }
            }
          } catch {}
        });

        this.ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        this.ws.on('close', () => {
          this.ws = null;
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  /**
   * 发送底层 CDP 命令
   */
  public async sendCommand(method: string, params: any = {}, timeoutMs: number = 30000): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const id = this.messageId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCallbacks.has(id)) {
          this.pendingCallbacks.delete(id);
          reject(new Error(`[CdpPageClient] 命令超时 (${timeoutMs}ms): ${method}`));
        }
      }, timeoutMs);

      this.pendingCallbacks.set(id, {
        resolve: (res: any) => { clearTimeout(timer); resolve(res); },
        reject: (err: any) => { clearTimeout(timer); reject(err); },
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * 执行 JavaScript 表达式并获取结果
   */
  public async evaluate(code: string | ((...args: any[]) => any), arg?: any): Promise<any> {
    let expression: string;
    if (typeof code === 'function') {
      let fnStr = code.toString();
      // 剥离可能残留在函数源码中的 TypeScript 类型断言，防止浏览器引擎报 SyntaxError: Unexpected identifier 'as'
      fnStr = fnStr.replace(/\s+as\s+[A-Za-z0-9_<>\[\] |?]+/g, '');
      expression = `(${fnStr})(${arg !== undefined ? JSON.stringify(arg) : ''})`;
    } else {
      expression = code;
    }

    const res = await this.sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (res?.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }

    return res?.result?.value;
  }

  public url(): string {
    return this.targetInfo.url;
  }

  /**
   * 原生注入本地文件到 input[type="file"]
   * 彻底穿透 Shadow DOM (如 wujie 微前端) 与 iframe，直接获取 RemoteObject objectId 注入
   */
  public async setInputFiles(selector: string, filePath: string): Promise<boolean> {
    // 穿透 Shadow DOM / iframe 寻找所有可能的文件 input（type=file 或 accept 含 video）
    const FIND_FILE_INPUT_EXPR = `(() => {
      const walk = (root) => {
        if (!root) return null;
        try {
          // 优先匹配 type=file；其次匹配 accept 含 video
          const hits = root.querySelectorAll
            ? Array.from(root.querySelectorAll('input[type="file"]'))
            : [];
          const videoHits = root.querySelectorAll
            ? Array.from(root.querySelectorAll('input[accept]')).filter(el =>
                (el.getAttribute('accept') || '').toLowerCase().includes('video')
              )
            : [];
          const found = [...hits, ...videoHits];
          if (found.length > 0) return found[0];
        } catch {}
        const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const el of all) {
          if (el.shadowRoot) {
            const r = walk(el.shadowRoot);
            if (r) return r;
          }
          if (el.tagName === 'IFRAME') {
            try {
              const d = el.contentDocument;
              const r = d && walk(d);
              if (r) return r;
            } catch {}
          }
        }
        return null;
      };
      return walk(document);
    })()`;

    // 1. 穿透递归查找 input[type="file"] 并直接获取其 RemoteObject 的 objectId
    try {
      const evalRes = await this.sendCommand('Runtime.evaluate', {
        expression: FIND_FILE_INPUT_EXPR,
        returnByValue: false, // 必须为 false 以拿到 objectId
      });

      if (evalRes?.result?.objectId) {
        await this.sendCommand('DOM.setFileInputFiles', {
          files: [filePath],
          objectId: evalRes.result.objectId,
        });
        return true;
      }
    } catch {}

    // 2. 备用兜底：深度扫描 DOM performSearch (包含 UserAgentShadowDOM)
    try {
      const searchRes = await this.sendCommand('DOM.performSearch', {
        query: '//input[@type="file"] | //input[contains(@accept,"video")]',
        includeUserAgentShadowDOM: true,
      });

      if (searchRes?.searchId && searchRes.resultCount > 0) {
        const results = await this.sendCommand('DOM.getSearchResults', {
          searchId: searchRes.searchId,
          fromIndex: 0,
          toIndex: 1,
        });
        if (results?.nodeIds && results.nodeIds.length > 0) {
          await this.sendCommand('DOM.setFileInputFiles', {
            files: [filePath],
            nodeId: results.nodeIds[0],
          });
          return true;
        }
      }
    } catch {}

    return false;
  }

  private lastMouseX: number = 400;
  private lastMouseY: number = 300;

  /**
   * 模拟人类三阶贝塞尔曲线平滑移动鼠标 (含手部肌肉微弧度、微震颤与过冲回弹)
   */
  public async mouseMove(x: number, y: number, options: { steps?: number; jitter?: boolean } = {}): Promise<void> {
    const targetX = options.jitter !== false ? Math.round(x + (Math.random() - 0.5) * 4) : Math.round(x);
    const targetY = options.jitter !== false ? Math.round(y + (Math.random() - 0.5) * 4) : Math.round(y);

    const startX = this.lastMouseX;
    const startY = this.lastMouseY;
    const distance = Math.hypot(targetX - startX, targetY - startY);

    // 根据移动距离自适应离散步数 (8 ~ 22 步)
    const steps = options.steps || Math.min(Math.max(Math.floor(distance / 45), 8), 22);

    // 三阶贝塞尔曲线控制点（带有人臂微弧度偏差）
    const arcSpread = Math.min(distance * 0.2, 50);
    const cp1X = startX + (targetX - startX) * 0.3 + (Math.random() - 0.5) * arcSpread;
    const cp1Y = startY + (targetY - startY) * 0.3 + (Math.random() - 0.5) * arcSpread;
    const cp2X = startX + (targetX - startX) * 0.7 + (Math.random() - 0.5) * arcSpread;
    const cp2Y = startY + (targetY - startY) * 0.7 + (Math.random() - 0.5) * arcSpread;

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      // 拟人非线性时间速度缓动 (人手启动慢、中途快、接近时减速)
      const u = 1 - t;
      const tt = t * t;
      const uu = u * u;
      const uuu = uu * u;
      const ttt = tt * t;

      let curX = Math.round(uuu * startX + 3 * uu * t * cp1X + 3 * u * tt * cp2X + ttt * targetX);
      let curY = Math.round(uuu * startY + 3 * uu * t * cp1Y + 3 * u * tt * cp2Y + ttt * targetY);

      // 叠加手指微颤（±1px）
      curX += Math.round((Math.random() - 0.5) * 2);
      curY += Math.round((Math.random() - 0.5) * 2);

      await this.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: curX, y: curY, buttons: 0 });
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8) + 10));
    }

    // 模拟终点轻微过冲与微校准 (Overshoot & Correction, 真人 Fitts 定律特征)
    if (distance > 100) {
      const overshootDist = Math.floor(Math.random() * 3) + 2;
      const angle = Math.atan2(targetY - startY, targetX - startX);
      const overX = Math.round(targetX + Math.cos(angle) * overshootDist);
      const overY = Math.round(targetY + Math.sin(angle) * overshootDist);
      await this.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: overX, y: overY, buttons: 0 });
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15) + 20));
    }

    // 精确到达终点目标
    await this.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: targetX, y: targetY, buttons: 0 });
    this.lastMouseX = targetX;
    this.lastMouseY = targetY;
  }

  /**
   * 类似 Playwright 的硬件级物理鼠标点击：
   * 发送真实操作系统级事件流 (平滑多点轨迹移动 -> 悬停感知 -> 按压 -> 释放)，严禁任何 JS DOM 注入
   */
  public async mouseClick(x: number, y: number, options: { clickCount?: number; delayMs?: number; jitter?: boolean } = {}): Promise<void> {
    const clickCount = options.clickCount || 1;
    const delayMs = options.delayMs || (Math.floor(Math.random() * 40) + 70);

    // 微随机坐标抖动（±2px），打破绝对几何中心点的特征统计
    const targetX = options.jitter !== false ? Math.round(x + (Math.random() - 0.5) * 4) : Math.round(x);
    const targetY = options.jitter !== false ? Math.round(y + (Math.random() - 0.5) * 4) : Math.round(y);

    // 1. 生成平滑多点三阶贝塞尔拟人移动轨迹
    await this.mouseMove(targetX, targetY, { jitter: false });

    // 悬停感知（模拟人眼确认目标元素 60ms ~ 120ms）
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 60) + 60));

    // 2. 模拟真实手指按压鼠标按键 (W3C规范: mousedown 阶段 buttons 掩码必须为 1)
    await this.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: targetX, y: targetY, button: 'left', buttons: 1, clickCount });
    await new Promise((r) => setTimeout(r, delayMs));

    // 3. 模拟按键抬起释放 (W3C规范: mouseup 阶段 buttons 掩码必须为 0)
    await this.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetX, y: targetY, button: 'left', buttons: 0, clickCount });
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 40) + 60));
  }

  /**
   * 类似 Playwright 的物理键盘击键打字：
   * 模拟真实人类击键节奏与随机停顿
   */
  public async typeText(text: string, options: { minDelay?: number; maxDelay?: number } = {}): Promise<void> {
    const minDelay = options.minDelay ?? 35;
    const maxDelay = options.maxDelay ?? 90;

    for (const char of text) {
      if (char === '\n') {
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, unmodifiedText: '\r', text: '\r' });
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13 });
      } else {
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: char });
      }
      const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  /**
   * 硬件级物理快捷键：全选并清除当前聚焦输入框内容 (macOS: Cmd+A, Win/Linux: Ctrl+A -> Backspace)
   */
  public async selectAllAndClear(): Promise<void> {
    // 派发全选修饰键 (macOS 使用 Meta 掩码 4；Windows/Linux 使用 Control 掩码 2)
    const isMac = process.platform === 'darwin';
    const modifierMask = isMac ? 4 : 2;
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a', modifiers: modifierMask });
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 65, code: 'KeyA', key: 'a', modifiers: modifierMask });
    await new Promise((r) => setTimeout(r, 80));
    // 派发 Backspace 退格删除键 (windowsVirtualKeyCode: 8)
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
    await new Promise((r) => setTimeout(r, 100));
  }

  /**
   * 硬件级物理退格键 Backspace（模拟逐字删除）
   */
  public async backspace(times: number = 1): Promise<void> {
    for (let i = 0; i < times; i++) {
      await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
      await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
      if (times > 1) {
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 30) + 40));
      }
    }
  }

  /**
   * 派发 End 键，将光标移动到当前输入控件文本的最末端
   */
  public async pressEnd(): Promise<void> {
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 35, code: 'End', key: 'End' });
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 35, code: 'End', key: 'End' });
    await new Promise((r) => setTimeout(r, 60));
  }

  /**
   * 派发单键按下与抬起 (如 Escape, Enter, Tab 等)
   */
  public async pressKey(key: string, windowsVirtualKeyCode?: number): Promise<void> {
    const codeMap: Record<string, { code: string; vk: number }> = {
      Escape: { code: 'Escape', vk: 27 },
      Enter: { code: 'Enter', vk: 13 },
      Tab: { code: 'Tab', vk: 9 },
    };
    const mapped = codeMap[key] || { code: key, vk: windowsVirtualKeyCode || 0 };
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: mapped.vk, code: mapped.code, key });
    await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: mapped.vk, code: mapped.code, key });
    await new Promise((r) => setTimeout(r, 60));
  }

  /**
   * 工业级高级拟人输入（对标真人击键）：
   * 1. 使用原生 Input.insertText 协议，触发浏览器内核级物理输入事件流 (isTrusted: true)；
   * 2. 模拟真实打字肌肉频率与随机长短停顿 (40ms ~ 120ms)；
   * 3. 模拟偶尔输入手误 (3% 概率打错字符) -> 停顿认知 -> 按 Backspace 物理退格删除 -> 重新敲入正确字符；
   * 4. 彻底杜绝使用 document.execCommand 或直接修改 DOM input.value 的机器人特征！
   */
  public async typeTextHumanLike(text: string, options: { enableTypo?: boolean } = {}): Promise<void> {
    const enableTypo = options.enableTypo !== false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // 偶发模拟手误打错：针对普通字母或数字
      if (enableTypo && Math.random() < 0.03 && /[a-zA-Z0-9]/.test(char)) {
        const typoChar = String.fromCharCode(char.charCodeAt(0) + 1);
        await this.sendCommand('Input.insertText', { text: typoChar });
        // 模拟人眼发现打错了的认知停顿 (160ms ~ 280ms)
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 120) + 160));
        // 模拟按下物理 Backspace 退格删除 (具备 40ms ~ 70ms 真实物理弹起时间差)
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 30) + 40));
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' });
        // 修正后短暂停顿
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 80) + 100));
      }

      // 输入真实字符 (支持多国语言、中文及符号)
      if (char === '\n') {
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r', unmodifiedText: '\r' });
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 30) + 40));
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'char', text: '\r' });
        await this.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter' });
      } else {
        await this.sendCommand('Input.insertText', { text: char });
      }

      // 字符间自然手部微间隔 (45ms ~ 115ms)
      const charDelay = Math.floor(Math.random() * 70) + 45;
      await new Promise((r) => setTimeout(r, charDelay));
    }
  }

  /**
   * 类似 Playwright 的 locator.click()：
   * 纯通过渲染盒模型定位真实屏幕物理中心坐标，随后由 CDP 发起硬件鼠标事件
   */
  public async clickSelector(selector: string, timeoutMs: number = 6000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const rect = await this.evaluate((sel: string) => {
        const el: any = document.querySelector(sel);
        if (!el) return null;
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        }
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
        };
      }, selector);

      if (rect && rect.x > 0 && rect.y > 0) {
        await this.mouseClick(rect.x, rect.y);
        return true;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    return false;
  }

  /**
   * 通过原生 CDP 穿透 Shadow DOM (包含 closed 模式) 与 iframe 获取元素的真实视口物理中心坐标
   * 彻底解决第三方 Web Component 组件封闭导致的 JS 查找失灵问题
   */
  public async getElementBoxModel(query: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
    try {
      const searchRes = await this.sendCommand('DOM.performSearch', {
        query,
        includeUserAgentShadowDOM: true,
      });

      if (searchRes?.searchId && searchRes.resultCount > 0) {
        const results = await this.sendCommand('DOM.getSearchResults', {
          searchId: searchRes.searchId,
          fromIndex: 0,
          toIndex: Math.min(searchRes.resultCount, 5),
        });

        await this.sendCommand('DOM.discardSearchResults', { searchId: searchRes.searchId }).catch(() => {});

        if (results?.nodeIds && results.nodeIds.length > 0) {
          for (const nodeId of results.nodeIds) {
            try {
              const box = await this.sendCommand('DOM.getBoxModel', { nodeId });
              if (box?.model?.content && box.model.content.length >= 8) {
                const c = box.model.content;
                const cx = Math.round((c[0] + c[4]) / 2);
                const cy = Math.round((c[1] + c[5]) / 2);
                const w = box.model.width || Math.round(Math.abs(c[2] - c[0]));
                const h = box.model.height || Math.round(Math.abs(c[7] - c[1]));
                if (w > 0 && h > 0 && cx > 0 && cy > 0) {
                  return { x: cx, y: cy, width: w, height: h };
                }
              }
            } catch {}
          }
        }
      }
    } catch {}
    return null;
  }

  /**
   * 诊断当前页面的真实 DOM / Shadow DOM / iframe 结构
   */
  public async diagnoseDomEnvironment(): Promise<{
    url: string;
    title: string;
    shadowHosts: number;
    fileInputs: number;
    iframes: number;
    plainFileInputs: number;
  }> {
    try {
      const res = await this.sendCommand('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => {
          let shadowHosts = 0, fileInputs = 0;
          const walk = (root) => {
            if (!root) return;
            try {
              fileInputs += root.querySelectorAll('input[type="file"], input[accept*="video"]').length;
            } catch {}
            const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
            for (const el of all) {
              if (el.shadowRoot) {
                shadowHosts++;
                walk(el.shadowRoot);
              }
              if (el.tagName === 'IFRAME') {
                try {
                  const d = el.contentDocument;
                  if (d) walk(d);
                } catch {}
              }
            }
          };
          walk(document);
          return {
            url: location.href,
            title: document.title,
            shadowHosts,
            fileInputs,
            iframes: document.querySelectorAll('iframe').length,
            plainFileInputs: document.querySelectorAll('input[type="file"], input[accept*="video"]').length
          };
        })()`,
      });
      return (
        res?.result?.value || {
          url: '',
          title: '',
          shadowHosts: 0,
          fileInputs: 0,
          iframes: 0,
          plainFileInputs: 0,
        }
      );
    } catch {
      return { url: '', title: '', shadowHosts: 0, fileInputs: 0, iframes: 0, plainFileInputs: 0 };
    }
  }

  /**
   * 优雅关闭连接并清理全部待处理回调与监听
   */
  public close(): void {
    this.isClosed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.pendingCallbacks.clear();
    this.eventListeners.clear();
  }

  public isClosedNow(): boolean {
    return this.isClosed || !this.ws || this.ws.readyState !== WebSocket.OPEN;
  }
}

export class CdpBridgeService {
  private static instance: CdpBridgeService;
  private cdpPort: number = DEFAULT_CDP_PORT;

  private constructor() {
    const envPort = process.env.ELECTRON_CDP_PORT || process.env.CDP_PORT;
    if (envPort) {
      this.cdpPort = parseInt(envPort, 10) || DEFAULT_CDP_PORT;
    }
  }

  public static getInstance(): CdpBridgeService {
    if (!CdpBridgeService.instance) {
      CdpBridgeService.instance = new CdpBridgeService();
    }
    return CdpBridgeService.instance;
  }

  public getPort(): number {
    return this.cdpPort;
  }

  public async disconnect(): Promise<void> {
    // 页面级客户端随 session 管理自动释放
  }

  /**
   * 查询当前 Chromium 开启的所有 Targets 列表 (使用 Node 原生 http 模块直连，彻底杜绝 Electron webRequest 误拦截)
   */
  public async getTargets(): Promise<CdpTargetInfo[]> {
    return new Promise((resolve) => {
      try {
        const req = http.get(`http://127.0.0.1:${this.cdpPort}/json/list`, (res) => {
          if (res.statusCode !== 200) return resolve([]);
          let rawData = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            try {
              const list = JSON.parse(rawData) as CdpTargetInfo[];
              resolve(Array.isArray(list) ? list : []);
            } catch {
              resolve([]);
            }
          });
        });

        req.on('error', () => resolve([]));
        req.setTimeout(2500, () => {
          req.destroy();
          resolve([]);
        });
      } catch {
        resolve([]);
      }
    });
  }

  /**
   * 快速、精准获取对应平台的 CDP 客户端 (直连 Target WebSocket，0超时)
   */
  public async getClientForPlatform(platform: 'wechat' | 'xiaohongshu', webContents?: WebContents, timeoutMs: number = 10000): Promise<CdpPageClient> {
    const startTime = Date.now();

    const isPlatformUrl = (url: string) => {
      if (!url) return false;
      const lower = url.toLowerCase();
      if (platform === 'wechat') {
        return lower.includes('weixin.qq.com') || lower.includes('channels.weixin') || lower.includes('mp.weixin') || lower.includes('qq.com');
      } else {
        return lower.includes('xiaohongshu.com') || lower.includes('xhslink.com') || lower.includes('creator.xiaohongshu');
      }
    };

    while (Date.now() - startTime < timeoutMs) {
      const targets = await this.getTargets();

      // 1. 优先匹配明确包含平台关键词且拥有 WebSocket 调试地址的 Target
      const platformTargets = targets.filter((t) => t.webSocketDebuggerUrl && isPlatformUrl(t.url));

      let match: CdpTargetInfo | undefined;
      const expectedUrl = webContents && !webContents.isDestroyed() ? webContents.getURL() : '';

      if (expectedUrl && platformTargets.length > 0) {
        // 优先完全匹配当前 WebContents 的 URL
        match = platformTargets.find((t) => t.url === expectedUrl);
      }

      if (!match && platformTargets.length > 0) {
        // 优先匹配包含 /publish 或 /post 发布路径的目标 Target
        match = platformTargets.find((t) => t.url.includes('/publish') || t.url.includes('/post') || t.url.includes('/create'));
      }

      if (!match && platformTargets.length > 0) {
        // 兜底选取第一个匹配的平台 Target
        match = platformTargets[0];
      }

      // 2. 若页面刚打开尚处于 about:blank 或初始跳转过渡态，尝试匹配非主站/非系统页面的最新 Page Target
      if (!match && targets.length > 0 && webContents && !webContents.isDestroyed()) {
        const candidatePages = targets.filter((t) =>
          t.webSocketDebuggerUrl &&
          !t.url.includes('shortvideo.ca') &&
          !t.url.includes('localhost') &&
          !t.url.startsWith('file://') &&
          !t.url.startsWith('devtools://')
        );
        if (candidatePages.length === 1) {
          match = candidatePages[0];
        }
      }

      if (match && match.webSocketDebuggerUrl) {
        try {
          const client = new CdpPageClient(match);
          await client.connect(5000);
          console.log(`[CdpBridge] 成功直连 ${platform} 页面 CDP WebSocket:`, match.webSocketDebuggerUrl, `(URL: ${match.url})`);
          return client;
        } catch (connErr: any) {
          console.warn(`[CdpBridge] 直连 ${platform} Target 临时重试中 (${connErr.message})...`);
        }
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    throw new Error(`[CdpBridge] 未能在指定时间内找到 ${platform} 对应的 CDP 页面 Target`);
  }
}

export const cdpBridge = CdpBridgeService.getInstance();
