/* 離線快取（由 tools/build.js 產生，請勿手動修改）。 */
const VERSION = 'xq-__VERSION__';
const MUSIC = 'xq-music-v1';
const PRECACHE = __PRECACHE__;
const MUSIC_FILES = __MUSIC__;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('xq-') && k !== VERSION && k !== MUSIC).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
    .then(() => self.clients.matchAll().then(list => list.forEach(c => c.postMessage({ type: 'offline-ready' })))));
  // 背景音樂比較大，啟用後在背景慢慢存，不擋住第一次開啟
  cacheMusic();
});
async function cacheMusic() {
  try {
    const c = await caches.open(MUSIC);
    for (const f of MUSIC_FILES) {
      if (await c.match(f)) continue;
      const res = await fetch(f, { cache: 'no-store' });
      if (res.ok && res.status === 200) await c.put(f, res);
    }
  } catch (e) { /* 網路不穩時下次再存 */ }
}
// 頁面每次開啟都會請它補存（手機可能中途停掉背景下載）
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'cache-music') event.waitUntil(cacheMusic());
});
// <audio> 會用 Range 要部分內容，從快取切出對應的片段回傳
async function rangeResponse(full, range) {
  const buf = await full.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  if (!m) return new Response(buf, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(buf.byteLength), 'Accept-Ranges': 'bytes' } });
  const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes ' + start + '-' + end + '/' + buf.byteLength, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
  });
}
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 頁面：先走網路，離線時用快取
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put('index.html', copy)); } return res; })
      .catch(() => caches.match('index.html', { ignoreSearch: true }).then(hit => hit || caches.match('./'))));
    return;
  }
  // 背景音樂：有存就從快取播（支援 Range），沒有就走網路並順便存起來
  if (url.origin === location.origin && url.pathname.includes('/assets/music/')) {
    const key = 'assets/music/' + url.pathname.split('/assets/music/')[1];
    event.respondWith(caches.open(MUSIC).then(c => c.match(key)).then(hit => {
      if (hit) return rangeResponse(hit, req.headers.get('range'));
      event.waitUntil(cacheMusic());
      return fetch(req);
    }));
    return;
  }
  // 其他同源資源與 Google 字型：快取優先，沒有就上網拿並存起來
  if (url.origin === location.origin || url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    event.respondWith(caches.match(req, { ignoreSearch: url.origin === location.origin }).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
