// 組建：產生 index.html（獨立版／PWA）、artifact 版頁面、简体中文字串與 Service Worker 快取清單。
// 用法：node tools/build.js [artifact 輸出路徑]
// 环境变量 PYTHON 指向裝有 opencc-python-reimplemented 的 Python，用來把繁體字串轉成简体。
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const rd = p => fs.readFileSync(path.join(root, p), 'utf8');
const wr = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };

// 1) 简体中文
(function zhcn() {
  const sandbox = {};
  new Function('window', rd('js/i18n.js'))(sandbox);
  const tw = sandbox.XQI18N['zh-TW'];
  const py = process.env.PYTHON || 'python';
  const tmpIn = path.join(require('os').tmpdir(), 'xq-i18n-tw.json'), tmpOut = path.join(require('os').tmpdir(), 'xq-i18n-cn.json');
  fs.writeFileSync(tmpIn, JSON.stringify(tw));
  try {
    cp.execFileSync(py, [path.join(__dirname, 'to_zhcn.py'), tmpIn, tmpOut], { stdio: 'inherit' });
    const cn = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    wr('js/i18n-zhcn.js', '/* 由 tools/build.js 以 OpenCC 從繁體中文自動轉換，請勿手動修改。 */\n(function (r) { r.XQI18N = r.XQI18N || {}; r.XQI18N["zh-CN"] = ' + JSON.stringify(cn, null, 1) + '; })(typeof window !== "undefined" ? window : globalThis);\n');
    console.log('i18n-zhcn.js: ' + Object.keys(cn).length + ' 條');
  } catch (e) {
    if (!fs.existsSync(path.join(root, 'js/i18n-zhcn.js'))) wr('js/i18n-zhcn.js', '/* 尚未產生简体字串 */\n');
    console.warn('略過简体轉換（找不到 opencc）：' + e.message);
  }
})();

// 2) 頁面
const body = rd('src/body.html');
const css = rd('css/app.css');
const SCRIPTS = ['js/engine.js', 'js/variant.js', 'js/i18n.js', 'js/i18n-zhcn.js', 'js/puzzles.js', 'js/audio.js', 'js/board.js', 'js/app.js'];
const ver = crypto.createHash('sha1').update(SCRIPTS.map(rd).join('') + css + body).digest('hex').slice(0, 8);
const scripts = SCRIPTS.map(s => '<script src="' + s + '?v=' + ver + '"></script>').join('\n');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=LXGW+WenKai+TC:wght@400;700&family=Noto+Serif+TC:wght@600;700&display=swap">';
const TITLE = '楚河漢界象棋';
const DESC = '可在電腦與手機（含 iPhone）上玩的象棋：經典象棋六種難度、鴉片戰爭（西洋棋 vs 象棋）、魔幻技能版、殺法練習、擺棋、全局分析、棋譜匯入匯出。';

const standalone = '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<title>' + TITLE + '</title>\n<meta name="description" content="' + DESC + '">\n' +
  '<meta name="theme-color" content="#e1e5df" media="(prefers-color-scheme: light)">\n<meta name="theme-color" content="#15110e" media="(prefers-color-scheme: dark)">\n' +
  '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">\n<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n' +
  '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="象棋">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="format-detection" content="telephone=no">\n' +
  fonts + '\n<link rel="stylesheet" href="css/app.css?v=' + ver + '">\n' +
  '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>\n</head>\n<body>\n' + body + '\n' + scripts + '\n</body>\n</html>\n';
wr('index.html', standalone);

const artifactOut = process.argv[2] || path.join(root, 'dist', 'artifact.html');
const inlineCss = css.replace(/\.\.\/assets\//g, 'assets/');
const artifact = '<title>' + TITLE + '</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="description" content="' + DESC + '">\n' + fonts + '\n<style>\n' + inlineCss + '\n</style>\n' + body + '\n' + scripts + '\n';
fs.mkdirSync(path.dirname(artifactOut), { recursive: true });
fs.writeFileSync(artifactOut, artifact);

// 3) Service Worker 快取清單
const list = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest', ...SCRIPTS];
const walk = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : [d + '/' + e.name]);
for (const d of ['assets/sounds', 'assets/textures', 'assets/fonts', 'assets/pieces', 'icons']) if (fs.existsSync(path.join(root, d))) list.push(...walk(d).filter(f => !/\.txt$/.test(f)));
const sw = rd('src/sw.template.js').replace('__VERSION__', ver).replace('__PRECACHE__', JSON.stringify(list, null, 1));
wr('sw.js', sw);
console.log('index.html、sw.js（' + list.length + ' 個檔案）與 ' + artifactOut + ' 已產生，版本 ' + ver);
