# ShortVideo 自动化发布平台反机器人（Anti-Robot Detection）深度防护机制

本文档详尽记录了 ShortVideo 桌面客户端在集成**微信视频号（Channels）**与**小红书创作者服务平台（Xiaohongshu）**时，为彻底防止被平台反爬虫、风控探针及反作弊 SDK 识别为机器人（Bot / Automation）所构建的完整多层防护体系。

---

## 目录
1. [底层 Chromium / Blink 内核级特征抹除](#1-底层-chromium--blink-内核级特征抹除)
2. [浏览器环境与指纹深度伪装 (Stealth Script)](#2-浏览器环境与指纹深度伪装-stealth-script)
3. [硬件级物理事件仿真 (CDP 原生驱动)](#3-硬件级物理事件仿真-cdp-原生驱动)
4. [DOM 零污染与页面纯净性保障](#4-dom-零污染与页面纯净性保障)
5. [平台专属业务场景与行为动力学优化](#5-平台专属业务场景与行为动力学优化)

---

## 1. 底层 Chromium / Blink 内核级特征抹除

平台反爬脚本通常优先在 Blink C++ 引擎层探测浏览器是否受自动化工具驱动。我们在应用启动生命周期首发阶段（`main.ts`）配置了核心命令行开关：

- **`disable-blink-features: AutomationControlled`**
  - **原理**：从 Blink 渲染引擎层彻底关闭自动化受控特性。该选项直接消除了原生 Chromium 暴露给 JavaScript 的 `navigator.webdriver = true` 默认属性。
- **`disable-features: AutofillServerCommunication,Autofill,AutomationControlled`**
  - **原理**：屏蔽 DevTools 协议中的自动化特征，同时消除由于 Electron 未搭载全套表单组件导致的底层协议报警。
- **`disable-infobars`**
  - **原理**：消除浏览器顶部“Chrome 正受到自动测试软件的控制”黄色通知提示条。
- **`lang: zh-CN`**
  - **原理**：强制底层 Chromium 网络栈发出的所有 HTTP 请求标头中携带符合中文桌面环境的 `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`，避免无头或默认英文暴露。
- **启用硬件真实 GPU 渲染**
  - `enable-gpu`, `enable-webgl`, `ignore-gpu-blocklist`
  - **原理**：强制启用宿主机独立显卡或集成显卡硬件加速，彻底杜绝无头浏览器（Headless）常见的 SwiftShader 或 llvmpipe 软件模拟渲染器特征。

---

## 2. 浏览器环境与指纹深度伪装 (Stealth Script)

在目标页面任意脚本执行前，通过 CDP `Page.addScriptToEvaluateOnNewDocument` 和 Electron 的 `did-create-document-element` 抢先注入工业级 [anti-detection.ts](file:///d:/Github/ShortVideo/electron/stealth/anti-detection.ts)，严密覆盖所有指纹检测维度：

### 2.1 原生 `Function.prototype.toString` 防护与多级子 iframe 防借壳穿透
- 凡是被安全修饰或重写的 JavaScript 方法，均通过 `WeakSet` 与 `makeNative` 进行受保护注册。
- 当外部风控脚本执行 `fn.toString()` 时，恒定返回标准的 `function [name]() { [native code] }`，完美避开函数的源码检测。
- **高阶借壳逃逸防御**：针对反爬探针动态创建隐藏子 iframe（`document.createElement('iframe')`）借用未受污染的 `contentWindow.Function.prototype.toString` 探测宿主被覆盖函数的行为，安全挂钩 `HTMLIFrameElement.prototype.contentWindow`，将防检测包装同步覆盖至所有子 frame，彻底封死借壳逃逸通道。

### 2.2 擦除 Node.js / Electron / CDP / 自动化工具特征残留
- 彻底清理挂载在 `window` 与 `document` 下的所有运行态与自动化残留：
  - Node / Electron: `process`, `Buffer`, `require`, `module`, `exports`, `global`, `__dirname`, `__filename`, `__electron`, `_electron`；
  - CDP / ChromeDriver 探针特征: `cdc_adoQpoasnfa76pfcZLmcfl_Array`, `cdc_adoQpoasnfa76pfcZLmcfl_Promise`, `cdc_adoQpoasnfa76pfcZLmcfl_Symbol`, `$cdc_asdjflasutopfhvcZLmcfl_`；
  - Selenium / WebDriver: `__webdriver_evaluate`, `__selenium_evaluate`, `__webdriver_script_function`, `__fxdriver_evaluate`, `__driver_evaluate`, `domAutomation`, `domAutomationController`；
  - Playwright / Puppeteer: `__playwright`, `__pw_manualStatus`, `__puppeteer_evaluation_script__`, `__nightmare`, `_phantom`。

### 2.3 `navigator.webdriver` 深度防护
- 清除 `navigator` 实例对象上的任何自有 `webdriver` 属性。
- 确保 `Navigator.prototype.webdriver` 的 getter 永远返回 `false`，同时维持 `Object.prototype.hasOwnProperty.call(navigator, 'webdriver') === false` 的原型链标准规范。
- **高阶非法调用防御**：对 `get webdriver` 增加 `this instanceof Navigator` 检验，若外部以空对象 `call({})` 探测非法执行，抛出标准 C++ 原生异常 `TypeError: Illegal invocation`，完美通过类似 CreepJS、BotD 等极限反自动化用例的探测。

### 2.4 `navigator.plugins` 与 `navigator.mimeTypes` 完整原型模拟
- **核心风险点**：纯净 Electron 或无头容器中，`navigator.plugins.length` 默认恒等于 `0`，且缺失 `[Symbol.iterator]` 迭代器，这是小红书、腾讯防水墙等反作弊引擎最核心的一击必杀特征。
- **实现方案**：
  - 构造符合标准 `PluginArray.prototype` 与 `MimeTypeArray.prototype` 原型链的完整对象。
  - 搭载标准 Google Chrome 128 的 5 种官方 PDF 插件（`PDF Viewer`, `Chrome PDF Viewer`, `Chromium PDF Viewer`, `Microsoft Edge PDF Viewer`, `WebKit built-in PDF`）及其对应的 MIME 类型映射。
  - 补齐标准 `[Symbol.iterator]`，原生支持 `for (const p of navigator.plugins)`、`[...navigator.plugins]` 及 `Array.from(navigator.plugins)`。
  - 搭载标准 `[Symbol.toStringTag]`，确保 `Object.prototype.toString.call(navigator.plugins) === '[object PluginArray]'`。
  - 支持 `plugins[0]`, `plugins['PDF Viewer']`, `item()`, `namedItem()`, `refresh()` 等原生规范调用，且方法均具备 `[native code]` 保护。

### 2.5 `navigator.userAgentData` 原型链清洗
- 针对 Chromium 新一代 Client Hints 规范，深度清洗 `userAgentData.brands` 列表，过滤任何带有 `Electron` 的字段，对齐官方 Chrome 128。
- 保留完整的 `getHighEntropyValues` 与 `toJSON` 方法规范。

### 2.6 标准 `window.chrome` 运行环境还原
- 补齐未受控桌面 Chrome 具备的 `chrome.app`, `chrome.csi`, `chrome.loadTimes` 原生方法与时间戳结构。
- 坚决不注入已被各大反爬 SDK 加入黑名单的旧版特征（如 `chrome.runtime.PlatformOs`）。

### 2.7 Web Component Shadow DOM 穿透拦截
- 安全挂钩 `Element.prototype.attachShadow`。当页面组件以 `mode: 'closed'` 创建闭合 Shadow DOM 时（如小红书 `<xhs-publish-btn>`），在底层安全转化为 `mode: 'open'`。
- 确保自动化协议可直接读取和操控内部物理节点，同时对外保留原生 toString 特征。

### 2.8 显卡与上下文对齐
- 过滤 WebGL 的 `getParameter(37445)` (VENDOR) 与 `getParameter(37446)` (RENDERER)，杜绝暴露 `Google SwiftShader`。
- 将 `Notification.permission` 与 `navigator.permissions.query({ name: 'notifications' })` 的返回状态严格同步为 `'default'`。

### 2.9 硬件核心数与触控点对齐 (典型 PC 指纹)
- 强制保障 `navigator.hardwareConcurrency >= 4`（默认伪装为 8 核 CPU），消除无头/虚拟机单核环境特征。
- 强制定义桌面端 `navigator.maxTouchPoints === 0`，与标准 Windows 桌面无触控屏幕环境精准对齐。

### 2.10 屏幕任务栏高度差值仿真
- 在真实 Windows 桌面操作系统中，由于底部存在系统任务栏，`screen.availHeight` 必定小于 `screen.height`（如 $1040\text{px} < 1080\text{px}$）。
- 脚本自适应为 `availHeight` 扣除典型任务栏高度（$40\text{px}$），彻底消除 `availHeight === height` 的纯容器检测破绽。

### 2.11 防页面定时器死循环 `debugger` 反自动化挂起
- 部分平台风控脚本会在 `setInterval` 或递归 `setTimeout` 中高频注入 `debugger;` 试图使连接了 CDP 调试端口的浏览器暂停（Paused in debugger）导致自动化流程卡死。
- 脚本对 `window.setInterval` 与 `window.setTimeout` 实施双重安全过滤，动态识别包含反调试断点的定时器执行并安全旁路（返回有效句柄但不执行断点），确保发布主流程无阻断推进。

---

## 3. 硬件级物理事件仿真 (CDP 原生驱动)

项目全面遵循 Playwright 协议精神，通过原生 Chrome DevTools Protocol（CDP）通道物理驱动页面，严禁通过直接修改 CSS 或调用 `input.value = ...` / `document.execCommand` 操控前端：

### 3.1 拟人缓动多点轨迹鼠标点击（`client.mouseClick`）
- **坐标微随机抖动**：每次点击在目标图元物理中心附加 $\pm 2\text{px}$ 随机扰动，打破绝对几何中心的死板统计。
- **手部肌肉缓动轨迹**：
  - 不采用机械直线跳跃，而是依据当前鼠标坐标与目标坐标计算欧氏距离，分段生成带微弧度偏移的拟人缓动曲线。
  - 模拟手部微颤与速度起伏，连续派发多点 `Input.dispatchMouseEvent (type: mouseMoved)`。
- **悬停感知**：光标移动到目标元素后，加入 $50\text{ms} \sim 90\text{ms}$ 短暂悬停停顿（模拟人眼视觉确认）。
- **W3C `buttons` 掩码严谨派发**：
  - `mousePressed` 阶段：显式声明 `button: 'left', buttons: 1`。
  - `mouseReleased` 阶段：显式声明 `button: 'left', buttons: 0`。
  - 严格满足前端高精度安全探针对鼠标物理按压状态的底层事件校验。

### 3.2 键盘敲击与输入手误退格（`client.typeTextHumanLike`）
- **内核级事件流**：使用原生 `Input.insertText` 与 `Input.dispatchKeyEvent`，派发的事件在浏览器内部被判定为 `isTrusted: true`。
- **肌肉节奏停顿**：击键间隔引入正态分布的高斯随机延迟（$45\text{ms} \sim 115\text{ms}$）。
- **偶尔手误与撤销模拟**：
  - 模拟真实打字员约 $3\%$ 的按键手误概率。
  - 发生手误时：输入邻近错误字符 $\to$ 停顿 $160\text{ms} \sim 280\text{ms}$（人眼识别到打错） $\to$ 派发物理 `Backspace` 按键 $\to$ 短暂恢复停顿 $\to$ 重新敲入正确字符。
- **按键物理回弹延迟**：
  - `rawKeyDown` 与 `keyUp` 之间保留 $40\text{ms} \sim 70\text{ms}$ 真实物理弹性键程耗时，彻底消除 0ms 瞬间抬起机械特征。

### 3.3 复制粘贴准备耗时（`simulateClipboardHesitation`）
- 针对长篇富文本描述，允许批量粘贴注入，但在执行聚焦和粘贴前，强制模拟用户在剪贴板操作中的停顿与准备耗时（$1.2\text{s} \sim 2.0\text{s}$）。

### 3.4 CDP 原生物理穿透闭合 Shadow DOM（`client.getElementBoxModel`）
- **核心痛点**：第三方现代前端框架（如 Vue 3 Web Component、Polymer、Lit 等）使用声明式或封闭的 `<template shadowrootmode="closed">`，普通 JavaScript 的 `document.querySelector` 与 `shadowRoot` 均返回 `null`，导致自动化完全“失明”。
- **底层穿透方案**：
  - 调用 CDP 原生协议 `DOM.performSearch` 并开启 `includeUserAgentShadowDOM: true`，强行穿透 Blink 渲染管线内部所有 open/closed 的 Shadow DOM 树；
  - 随后直接调用 `DOM.getBoxModel`，由 Chromium 渲染排版引擎返回该元素在屏幕上的 4 组绝对物理四边形顶点坐标 `model.content`；
  - 精确计算中心点 $(x_1 + x_3) / 2$ 与 $(y_1 + y_3) / 2$，直接获得屏幕绝对视口坐标，交由真实鼠标硬件事件派发点击，彻底终结 Web Component 元素无法点击的顽疾。

---

## 4. DOM 零污染与页面纯净性保障

传统自动化脚本常在目标第三方网页中插入调试元素、悬浮球、Toast 提示或自定义属性（如 `data-automation-id`），极易被第三方网页的 `MutationObserver` 和网页反作弊截屏探针捕获封号。

本项目确立并严格践行**“宿主 DOM 零接触”**准则：
- **发布流水线步骤条（StepBar）**：从小红书与微信的网页 DOM 中彻底剥离，统一通过 Electron 原生 IPC 协议广播至宿主应用的专用原生 TabBar 中渲染。
- **Toast 状态通知提示**：所有上传进度、倒计时、状态回检信息均在宿主窗口层级展示，第三方平台的 DOM 树保持 100% 纯净。
- **选择器无痕探测**：纯粹通过几何盒模型计算坐标，不在目标页面注入任何标记性样式类或属性。

---

## 5. 平台专属业务场景与行为动力学优化

### 5.1 小红书（Xiaohongshu）防风控强化

1. **未登录一票否决与严格停留等待扫码**：
   - 彻底废除将访客 Cookie（如 `customerclientid`）误判为登录态的漏洞，建立一票否决机制：凡页面存在二维码（`canvas` / `img.qrcode`）、登录卡片（“短信登录”、“加入我们”）或登录遮罩，100% 判定为未登录；
   - **未登录状态下坚决停留在主页等待用户扫码**，绝不提前跳转发布页、绝不提前上传视频和填写文案；只有经真实创作者信息（头像、昵称、侧边栏导航）正向核验成功后，才允许进入下一步；
2. **自动切换为二维码扫码模式**：
   - 避开小红书短信验证码登录接口的高敏风控（常导致“请稍候...”卡死），启动时自动将登录卡片切换为二维码模式。
3. **通篇审视与翻页复核节奏**：
   - **信息填写完毕** $\to$ 平滑上翻页滚动至页面最顶端，伴随微小鼠标滚轮物理事件，**停留 2-3 秒**（模拟人工审视笔记全貌与封面）。
   - **审视完毕** $\to$ 平滑滚动返回底部发布区域，**停留 1-2 秒**（模拟聚焦发布按钮）。
   - **然后点击发布**。
4. **适配 `<xhs-publish-btn>` Web Component**：
   - 适配小红书最新封装的吸底自定义元素 `<xhs-publish-btn>`：
     ```html
     <xhs-publish-btn submit-text="发布" save-text="暂存离开" submit-disabled="false" submit-loading="false">
       <template shadowrootmode="closed">
         <div class="publish-page-publish-btn">
           <button class="ce-btn bg-red">发布</button>
         </div>
       </template>
     </xhs-publish-btn>
     ```
   - **三层立体防误触定位算法**：
     1. **真实节点直取（优先）**：遍历 ShadowRoot 内所有按钮，**严格排除**包含“暂存”文本或 `.white` 样式的按钮，精准锁定 `(txt === '发布' || cls.includes('bg-red'))` 的目标按钮并返回其视口几何中心；
     2. **CDP `DOM.getBoxModel` 深度穿透（核心主力）**：当遇到声明式封闭（Declarative Closed）Shadow DOM 导致 JS 无法直接遍历时，通过原生 XPath `//button[(contains(text(),"发布") or contains(@class,"bg-red")) and not(contains(text(),"暂存")) and not(contains(@class,"white"))]` 穿透 Blink 渲染管线，直接取得屏幕绝对物理盒模型进行点击，确保 100% 击中红色发布按钮；
     3. **单/双按钮几何自适应（极速兜底）**：若上述均未返回，读取宿主元素 `is-save-draft` 或 `save-text` 属性——为单按钮时取正中心；为双按钮（左侧为“暂存离开”，右侧为“发布”）时自动向右平移 $+72\text{px}$ 锁定红色“发布”按钮，绝不误触左侧的“暂存离开”或中间间隙。
5. **发布后二次确认弹窗自动闭环**：
   - 物理点击发布后，主动监听可能弹出的二次提示模态框（如灰度提示、封面默认确认等），检测到“确认发布” / “继续发布” / “确定”即自动派发真实物理点击，实现全流程 100% 无人值守闭环。
6. **原创声明须知精准锁定**：
   - 原创声明协议弹窗内，精确定位左侧 `.d-checkbox-simulator` 图元中心，绝不点击右侧文字，杜绝误触《原创声明须知》超链接导致新窗口跳转中断发布。

### 5.2 微信视频号（Channels）防风控强化

1. **未登录二维码一票否决与强行阻断抢跑**：
   - 深度检测微信页面中的 `.login-qrcode`、`.weui-desktop-qr-code`、`canvas` 及“微信扫码登录”文本；即使页面当前 URL 处于 `/post/create`，只要存在未登录二维码，一票否决判定为未登录；
   - **未登录状态下坚决停留等待用户微信扫码**，严格阻断后续一切页面跳转与视频注入操作，杜绝在扫码遮罩覆盖下发生误点击或超时崩溃；

2. **通篇审视与翻页复核节奏 (与小红书对齐)**：
   - 基础文案与高级设置配置完毕后，平滑上翻页滚动至发表页最顶部，停留 2-3 秒审视封面与标题全貌，再平滑滚回底部发表区域停留 1-2 秒，最后再监测转码并发表，使两端拟人动力学完全对齐。
3. **微前端 Shadow DOM / iframe 穿透递归**：
   - 穿透微信底层微前端架构（wujie），递归定位视频素材上传控件与表单组件。
4. **短标题 16 字符安全退格校验**：
   - 针对平台 16 字符硬性上限，若输入溢出，通过物理快捷键按 `End` 移至末尾，再通过真实 `Backspace` 退格逐字删除多余字符，而非直接暴力重置。
5. **原创权益弹窗双保险点击**：
   - 深度检测弹窗内声明协议的复选框图元，等待确认按钮解锁后再派发物理点击，并核验弹窗关闭状态。

---

## 总结

ShortVideo 桌面端通过**内核层特征抹除**、**指纹层环境补齐**、**协议层硬件拟人**、**DOM 零污染**以及**平台专属行为动力学**五大维度的协同配合，使整个自动化发布流程在各社交平台眼中与真实用户在 Windows 原生 Chrome 浏览器上的手工操作达到 100% 一致。
