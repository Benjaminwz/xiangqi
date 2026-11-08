/* 離線快取（由 tools/build.js 產生，請勿手動修改）。 */
const VERSION = 'xq-8c70430f';
const PRECACHE = [
 "./",
 "index.html",
 "css/app.css",
 "manifest.webmanifest",
 "js/engine.js",
 "js/variant.js",
 "js/i18n.js",
 "js/i18n-zhcn.js",
 "js/puzzles.js",
 "js/audio.js",
 "js/board.js",
 "js/app.js",
 "assets/sounds/capture1.mp3",
 "assets/sounds/capture2.mp3",
 "assets/sounds/check.mp3",
 "assets/sounds/click.mp3",
 "assets/sounds/draw.mp3",
 "assets/sounds/energy.mp3",
 "assets/sounds/illegal.mp3",
 "assets/sounds/lose.mp3",
 "assets/sounds/move1.mp3",
 "assets/sounds/move2.mp3",
 "assets/sounds/move3.mp3",
 "assets/sounds/promote.mp3",
 "assets/sounds/select.mp3",
 "assets/sounds/sk-arrows.mp3",
 "assets/sounds/sk-boats.mp3",
 "assets/sounds/sk-chain.mp3",
 "assets/sounds/sk-cicada.mp3",
 "assets/sounds/sk-fire.mp3",
 "assets/sounds/sk-fort.mp3",
 "assets/sounds/sk-freeze.mp3",
 "assets/sounds/sk-knife.mp3",
 "assets/sounds/sk-phoenix.mp3",
 "assets/sounds/sk-portal.mp3",
 "assets/sounds/sk-rage.mp3",
 "assets/sounds/sk-shield.mp3",
 "assets/sounds/sk-snipe.mp3",
 "assets/sounds/sk-spy.mp3",
 "assets/sounds/sk-stones.mp3",
 "assets/sounds/sk-swap.mp3",
 "assets/sounds/sk-thunder.mp3",
 "assets/sounds/solved.mp3",
 "assets/sounds/start.mp3",
 "assets/sounds/tick.mp3",
 "assets/sounds/win.mp3",
 "assets/textures/board_maple.jpg",
 "assets/textures/board_oak.jpg",
 "assets/textures/board_rosewood.jpg",
 "assets/textures/piece_wood.jpg",
 "assets/textures/table_dark.jpg",
 "assets/fonts/xq-kai.woff2",
 "assets/pieces/chess/bB.svg",
 "assets/pieces/chess/bK.svg",
 "assets/pieces/chess/bN.svg",
 "assets/pieces/chess/bP.svg",
 "assets/pieces/chess/bQ.svg",
 "assets/pieces/chess/bR.svg",
 "assets/pieces/chess/wB.svg",
 "assets/pieces/chess/wK.svg",
 "assets/pieces/chess/wN.svg",
 "assets/pieces/chess/wP.svg",
 "assets/pieces/chess/wQ.svg",
 "assets/pieces/chess/wR.svg",
 "assets/pieces/classic/bA.svg",
 "assets/pieces/classic/bB.svg",
 "assets/pieces/classic/bC.svg",
 "assets/pieces/classic/bK.svg",
 "assets/pieces/classic/bN.svg",
 "assets/pieces/classic/bP.svg",
 "assets/pieces/classic/bR.svg",
 "assets/pieces/classic/rA.svg",
 "assets/pieces/classic/rB.svg",
 "assets/pieces/classic/rC.svg",
 "assets/pieces/classic/rK.svg",
 "assets/pieces/classic/rN.svg",
 "assets/pieces/classic/rP.svg",
 "assets/pieces/classic/rR.svg",
 "assets/pieces/trad/bA.svg",
 "assets/pieces/trad/bB.svg",
 "assets/pieces/trad/bC.svg",
 "assets/pieces/trad/bK.svg",
 "assets/pieces/trad/bN.svg",
 "assets/pieces/trad/bP.svg",
 "assets/pieces/trad/bR.svg",
 "assets/pieces/trad/rA.svg",
 "assets/pieces/trad/rB.svg",
 "assets/pieces/trad/rC.svg",
 "assets/pieces/trad/rK.svg",
 "assets/pieces/trad/rN.svg",
 "assets/pieces/trad/rP.svg",
 "assets/pieces/trad/rR.svg",
 "icons/apple-touch-icon.png",
 "icons/favicon-32.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/maskable-512.png"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('xq-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 頁面：先走網路，失敗再用快取
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('index.html', copy)); return res; }).catch(() => caches.match('index.html')));
    return;
  }
  // 背景音樂：串流，不預先快取，播放過的才存起來
  if (url.origin === location.origin && url.pathname.includes('/assets/music/')) {
    event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }
  // 其他同源資源與 Google 字型：快取優先
  if (url.origin === location.origin || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    event.respondWith(caches.match(req, { ignoreSearch: url.origin === location.origin }).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
