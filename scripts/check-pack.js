// 打包后检查：安装包里必须带齐这些文件，缺任何一个就报错（防止像 v2.27 那样漏掉 bar.html）
const path = require('path');
const asar = require('@electron/asar');
const REQUIRED = ['main.js', 'preload.js', 'page-preload.js', 'inject.js', 'bar.html', 'ticker.html', 'donate.html',
  'package.json', 'icon.png', 'tray.png', 'donate/wechat.png', 'donate/alipay.png'];
const file = path.join(__dirname, '..', 'dist', 'WeReadMini-win32-x64', 'resources', 'app.asar');
const list = new Set(asar.listPackage(file).map((p) => p.replace(/\\/g, '/').replace(/^\//, '')));
const missing = REQUIRED.filter((f) => !list.has(f));
if (missing.length) { console.error('✗ 安装包缺少文件：' + missing.join(', ')); process.exit(1); }
console.log('✓ 安装包文件齐全（' + REQUIRED.length + ' 项）');
