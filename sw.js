const CACHE="yarntime-cache-v19";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon-192.png","./icon-512.png"];

self.addEventListener("install",e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

// 上線時優先抓最新檔案；離線時才用快取，避免更新後還看到舊版。
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET") return;
  e.respondWith(
    fetch(e.request)
      .then(resp=>{
        const copy=resp.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return resp;
      })
      .catch(()=>caches.match(e.request))
  );
});
