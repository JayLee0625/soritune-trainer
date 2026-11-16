// 앱 화면 파일을 저장해 두고, 인터넷이 되면 항상 새 버전을 받아요 (network-first)
var C = 'ipt-v5';
var FILES = ['./', 'index.html', 'app.js', 'audio.js', 'hwp.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(C).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== C; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  var req = e.request; try { req = new Request(e.request, { cache: 'no-cache' }); } catch (x) { } // 깃허브 캐시(10분)를 건너뛰고 새 파일 확인
  e.respondWith(fetch(req).then(function (r) { var cp = r.clone(); caches.open(C).then(function (c) { c.put(e.request, cp); }); return r; }).catch(function () { return caches.match(e.request); }));
});
