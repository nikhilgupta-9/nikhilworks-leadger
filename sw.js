/* NikhilWorks Ledger service worker.
 * Makes the app installable and keeps its look available when offline.
 * It deliberately never stores anything private: pages, api/ calls and all
 * non-GET requests always go to the network. Only static files (css/js/images)
 * are cached. */
var CACHE = "nw-ledger-static-v1";
var OFFLINE = "offline.html";

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return c.addAll([OFFLINE, "assets/img/icon-192.png", "assets/img/logo-icon.png"]);
  }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;
  var url = new URL(req.url);
  if(url.origin !== location.origin) return;                 // fonts etc. -> browser default
  if(/\/api\//.test(url.pathname)) return;                    // live data is never cached

  if(req.mode === "navigate"){                                // pages: network first, friendly offline fallback
    e.respondWith(fetch(req).catch(function(){ return caches.match(OFFLINE); }));
    return;
  }
  if(/\/assets\//.test(url.pathname)){                        // static files: cache first (URLs are versioned)
    e.respondWith(caches.match(req).then(function(hit){
      return hit || fetch(req).then(function(res){
        if(res && res.ok){ var copy = res.clone(); caches.open(CACHE).then(function(c){ c.put(req, copy); }); }
        return res;
      });
    }));
  }
});
