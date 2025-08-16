// holdings-v4 - cache bump
const CACHE = 'holdings-v4';
self.addEventListener('install', (e)=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll([
    './','./index.html','./app.js','./manifest.json','./icon-192.png','./icon-512.png','https://cdn.jsdelivr.net/npm/chart.js'
  ])));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e)=>{
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request).catch(()=>caches.match('./index.html')))
  );
});
