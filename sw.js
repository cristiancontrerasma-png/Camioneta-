const CACHE = "camioneta-v28";
const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const LOCALES = [
  "./", "index.html", "styles.css", "app.js", "cuenta.js", "checklist.js", "instalar.js", "fb.js", "exif.js", "firebase-config.js",
  "turno.html", "admin.html", "manifest.json", "icon.svg", "logo.png", "icon-180.png", "icon-192.png", "icon-512.png",
];
// El SDK de Firebase también se guarda, para que la app abra sin señal.
const EXTERNOS = ["firebase-app.js", "firebase-app-check.js", "firebase-auth.js", "firebase-firestore.js"].map((f) => SDK + f);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...LOCALES, ...EXTERNOS].map((u) => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // SDK de Firebase (versión fija): primero la copia guardada.
  if (url.href.startsWith(SDK)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const guardada = await c.match(e.request);
      if (guardada) return guardada;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Archivos de la app: primero la red (sin caché del navegador), para que cada cambio llegue en la misma apertura.
  // Si no hay señal o la red tarda más de 4 segundos, responde con la copia guardada.
  const clave = url.origin + url.pathname;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const red = fetch(e.request.url, { cache: "no-cache" }).then((r) => {
      if (r.ok) c.put(clave, r.clone());
      return r;
    });
    const guardada = await c.match(clave);
    if (!guardada) return red.catch(() => c.match("index.html"));
    e.waitUntil(red.catch(() => {}));
    const espera = new Promise((ok) => setTimeout(() => ok(null), 4000));
    const r = await Promise.race([red.catch(() => null), espera]);
    return r && r.ok ? r : guardada;
  }));
});
