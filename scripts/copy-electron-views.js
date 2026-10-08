const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'electron', 'views');
const destDir = path.join(__dirname, '..', 'dist-electron', 'views');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log('[copy-electron-views] Successfully copied views to dist-electron/views');
}
