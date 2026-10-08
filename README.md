# ShortVideo Desktop Client 🎬

Official cross-platform desktop application for **ShortVideo** (https://shortvideo.ca), built with Electron, TypeScript, and Playwright CDP.

## ✨ Features

- 🖥️ **Native Desktop Experience**: Access ShortVideo with smooth webview integration and native window controls.
- 🚀 **Social Publishing Automation**: One-click direct publishing to WeChat Channels (微信视频号) and Xiaohongshu (小红书).
- 🛡️ **Anti-Bot & Stealth**: Native CDP integration bypassing automated browser fingerprinting detection.
- 🌍 **Multilingual Support**: Fully localized interface in 14 languages.
- ⚡ **Auto-Updates**: Seamless cross-platform updates powered by `electron-updater`.

---

## 🛠️ Development & Build

### Prerequisites
- Node.js >= 18
- pnpm >= 8

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Run in Development Mode
```bash
pnpm run dev
```

### 3. Package Locally
```bash
# Package into unpacked directory
pnpm run pack

# Build production installers (exe / dmg / AppImage)
pnpm run dist
```

---

## 🚀 CI / CD & Release

This repository uses **GitHub Actions** for automated builds across Windows, macOS, and Linux:

1. Push a git tag (e.g. `v0.1.0`):
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
2. GitHub Actions will automatically compile installers for Windows, macOS, and Linux, and create a GitHub Release with download assets.

---

## 📄 License

MIT License. See [LICENSE](./LICENSE) for details.
