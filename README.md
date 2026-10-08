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

### Automated Tag & Release
- **Auto increment and push Tag**:
  ```bash
  pnpm run tag        # Increment patch tag (e.g. v0.1.1) and trigger GitHub Actions build
  pnpm run tagall     # Build all platforms (Windows + macOS + Linux)
  ```

- **Publish / Update GitHub Release notes**:
  ```bash
  pnpm run release    # Automatically sync release notes to GitHub Release page
  ```

Pushing a Tag triggers **GitHub Actions** (`.github/workflows/release.yml`) to automatically compile installers and publish release assets to GitHub.

---

## 📄 License

MIT License. See [LICENSE](./LICENSE) for details.
