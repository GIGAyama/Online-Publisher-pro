/**
 * オンライン出版社 Pro - PWAシェル用 Service Worker
 *
 * シェル（このフォルダの静的ファイル）だけをキャッシュします。
 * アプリ本体（Google Apps Script）は常にネットワークから読み込みます。
 * シェルを更新したら APP_VERSION を上げてください。
 */
/*
 * 【最重要】activate では自アプリ以外のキャッシュを削除しない。
 *   gigayama.github.io は数十個のアプリが同一オリジンを共有しているため、
 *   CACHE_PREFIX で始まるキャッシュだけを掃除する。
 *   以前はここで caches.keys() の結果を全部消していた。そのため
 *   このアプリを開くたびに、同じ端末に入っている他の GIGA アプリの
 *   キャッシュまで巻き添えで消え、それらがオフラインで起動しなくなっていた。
 *
 * この Service Worker は localStorage を一切操作しない。
 *   児童の書きかけ（monogatari_maker_pro_autosave など）に触れない。
 */
const CACHE_PREFIX  = 'opp-shell-';
const APP_VERSION   = 'v6';   // ← リリースごとに必ず上げる
const CACHE_STATIC  = CACHE_PREFIX + 'static-' + APP_VERSION;
const CACHE_RUNTIME = CACHE_PREFIX + 'runtime-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './config.js',
  './offline.html',
  './manifest.webmanifest',
  './favicon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    // addAll は1本でも失敗すると全体が落ちる。アイコンを1つ消しただけで
    // オフライン起動できなくなっていたため、1本ずつ入れて失敗は握りつぶす。
    await Promise.all(PRECACHE_URLS.map((u) =>
      cache.add(new Request(u, { cache: 'reload' }))
           .catch((err) => console.warn('[sw] precache skipped', u, err))
    ));
    // 待機中の新版は、利用者が「さいしんに する」を押したときだけ有効化する。
    // ここで skipWaiting() すると、書いている最中に画面が入れ替わることがある。
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      // ← 自アプリ接頭辞のものだけを削除する。ここを外すと
      //    同一オリジンの他アプリを巻き添えにする。
      .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_STATIC && k !== CACHE_RUNTIME)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 同一オリジン（＝シェル自身）のみキャッシュ対応。
  // GAS本体・フォント等の外部リソースには関与しない。
  if (url.origin !== self.location.origin) return;

  // 画面遷移は network-first。更新をすぐ届け、圏外なら offline.html を出す。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch (e) {
        return (await caches.match('./index.html'))
            || (await caches.match('./offline.html'))
            || Response.error();
      }
    })());
    return;
  }

  // 静的ファイルは cache-first（校内Wi-Fiが混んでいても即表示）
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE_RUNTIME).then((cache) => cache.put(req, copy));
    }
    return res;
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
