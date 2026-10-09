# 🎬 ShortVideo Desktop Client
> **Official Cross-Platform Desktop Client for ShortVideo Platform**

<p align="center">
  <a href="#-中文介绍">🇨🇳 简体中文</a> |
  <a href="#-english-overview">🇺🇸 English</a> |
  <a href="#-日本語紹介">🇯🇵 日本語</a> |
  <a href="#-한국어-소개">🇰🇷 한국어</a>
</p>

<p align="center">
  <a href="https://shortvideo.ca"><img src="https://img.shields.io/badge/Official_Website-shortvideo.ca-blue?style=flat-square" alt="Official Website"></a>
  <a href="https://app.shortvideo.ca"><img src="https://img.shields.io/badge/Web_Studio-app.shortvideo.ca-success?style=flat-square" alt="Web Studio"></a>
  <a href="https://download.shortvideo.ca"><img src="https://img.shields.io/badge/Download_Client-Windows_%7C_macOS_%7C_Linux-orange?style=flat-square" alt="Download Client"></a>
  <a href="https://github.com/SmartSchoolAI/ShortVideoDesktop/releases"><img src="https://img.shields.io/badge/GitHub-Releases-blue?style=flat-square" alt="GitHub Releases"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License"></a>
</p>

---

## 🇨🇳 中文介绍

**ShortVideo** 是一款面向全球短视频创作者、知识科普、跨境电商与内容团队的自动化视频生成、多语言字幕本地化与矩阵发布桌面/Web平台。

### ✨ 核心功能与亮点 (Key Features)

1. 🌐 **全球 14 种核心高 CPM 语言覆盖**：
   * 包含 **中文(zh)**、**英语(en)**、**日语(ja)**、**韩语(ko)**、**越南语(vi)**、**泰语(th)**、**印尼语(id)**、**西班牙语(es)**、**法语(fr)**、**葡萄牙语(pt)**、**德语(de)**、**意大利语(it)**、**俄语(ru)**、**土耳其语(tr)**。
   * 智能字幕翻译、多语言字幕排版与动态音画同步。

2. 🤖 **自动化社交平台发布 (Playwright / CDP)**：
   * 集成 **微信视频号 (Channels)** 与 **小红书 (RED)** 创作服务平台的自动化视频发布。
   * 采用原生 CDP/Playwright 协议，完全模拟人类拟真打字速率与物理交互，保障账号安全。

3. 📚 **全学科短视频创作支持**：
   * 涵盖 **英语**、**数学**、**物理**、**化学**、**历史**、**地理** 等多学科知识科普与教学短视频的高效渲染与生成。

4. 💻 **Web 在线制作 + 桌面客户端双重体验**：
   * 支持 Web 端在线快速制作与发布，同时提供桌面客户端，无缝进行视频号、小红书等平台的自动化一键发布。

5. 💰 **按需扣费，透明无会员绑架**：
   * 采用充值积分、按需实用实扣机制，无任何强制订阅与会员费，单条视频生成成本仅在 **2 - 4 元** 之间，性价比极高。

6. 📱 **多平台生态覆盖与演进**：
   * 已全面支持 **YouTube (油管)**、**微信视频号**、**小红书** 等主流平台；**抖音**、**B站**、**META (Facebook)**、**Instagram** 等平台正持续接入中。

7. 🎙️ **丰富优质声音模型选择**：
   * 内置多种顶级音色与声音模型，支持按语种、角色与情感灵活切换，打造逼真自然的配音体验。

---

## 🇺🇸 English Overview

**ShortVideo Desktop** is the official cross-platform desktop application for **ShortVideo** (https://shortvideo.ca), built with Electron, TypeScript, and Playwright CDP.

### ✨ Key Features & Highlights

1. 🌐 **Coverage of 14 Core High-CPM Languages Worldwide**:
   * Supports Chinese (zh), English (en), Japanese (ja), Korean (ko), Vietnamese (vi), Thai (th), Indonesian (id), Spanish (es), French (fr), Portuguese (pt), German (de), Italian (it), Russian (ru), and Turkish (tr).
2. 🤖 **Automated Social Publishing via Playwright & CDP**:
   * Native automation for **WeChat Channels** and **Xiaohongshu (RED)** with human-like interactions and anti-bot protection.
3. 📚 **All-Discipline Educational Content Support**:
   * English, Mathematics, Physics, Chemistry, History, and Geography video generation.
4. 💻 **Native Desktop Experience**:
   * Seamless window controls, hardware acceleration, and integrated publishing tools.
5. 💰 **Pay-As-You-Go, Zero Subscription Traps**:
   * Ultra-low generation cost (only ¥2 - ¥4 per video) with transparent usage.
6. 📱 **Continuous Platform Ecosystem Expansion**:
   * YouTube, Channels, RED, TikTok/Douyin, and Instagram matrix publishing.
7. 🎙️ **Neural AI Voice Models**:
   * Lifelike speech synthesis in diverse languages, styles, and tones.

---

## 🛠️ 本地开发与构建 (Development & Build)

### 必备环境 (Prerequisites)
- Node.js >= 18
- pnpm >= 8

### 1. 安装依赖
```bash
pnpm install
```

### 2. 运行本地开发调试
```bash
pnpm run dev
```

### 3. 本地打包构建
```bash
# 解包目录测试
pnpm run pack

# 生成跨平台正式安装包 (exe / dmg / AppImage)
pnpm run dist
```

---

## 🚀 自动化发布流 (CI / CD & Release)

```bash
# 1. 自动打 Tag 并推送到 GitHub (云端 GitHub Actions 开始并行编译三平台安装包)
pnpm run tagall

# 2. 一键秒级直发 (自动关联云端产物，纯云端内网秒级挂载至 GitHub Release，本地 0 流量消耗)
pnpm run release
```

---

## 📄 开源许可 (License)

[MIT License](./LICENSE) © 2026 ShortVideo Team.
