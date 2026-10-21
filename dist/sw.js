const CACHE='mail-wizard-v2';
const ASSETS=['./','./index.html','./styles.css','./app.js','./about.html','./about.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./modules/core.js','./modules/vault.js','./modules/demo.js','./modules/jmap.js','./modules/desktop.js','./modules/icons.js'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('mail-wizard-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),base=new URL(self.registration.scope);
  // Never cache provider traffic, private responses, or arbitrary same-origin URLs.
  if(event.request.method!=='GET'||url.origin!==base.origin||event.request.headers.has('Authorization'))return;
  const relative=url.pathname.slice(base.pathname.length);
  if(!ASSETS.some(asset=>asset.slice(2)===relative || (relative===''&&asset==='./')))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&response.type==='basic' && !response.redirected){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,clone)));}
    return response;
  }).catch(async()=>await caches.match(event.request,{ignoreSearch:true}) || await caches.match(new URL('index.html',self.registration.scope))));
});
