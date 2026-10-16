const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'electron', 'views');
const destDir = path.join(__dirname, '..', 'dist-electron', 'views');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  if (typeof fs.cpSync === 'function') {
    fs.cpSync(srcDir, destDir, { recursive: true });
  } else {
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const srcPath = path.join(srcDir, file);
      const dstPath = path.join(destDir, file);
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }
  console.log('[copy-electron-views] Successfully copied views to dist-electron/views');
}
