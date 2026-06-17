/* HERMES EL BOLITERO — service worker for Web Push notifications. */
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  var title = data.title || "HERMES EL BOLITERO";
  var opts = {
    body: data.body || "¡Nuevo aviso de la bolita!",
    icon: data.icon || "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [80, 40, 80],
    tag: data.tag || "hb-push",
    renotify: true,
    data: { url: data.url || "https://www.hermeselbolitero.com" },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "https://www.hermeselbolitero.com";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) { list[i].navigate(url); return list[i].focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
