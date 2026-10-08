// Service worker: makes the app installable, caches immutable build assets,
// and shows budget alerts. Pages and data always come from the network
// (they're behind auth).
const CACHE = "het-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/_next/static/") && !url.pathname.startsWith("/icons/")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    }),
  );
});

// Budget alerts (src/lib/push.ts sends { title, body, url, tag }).
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  const title = msg.title || "Budget alert";
  const body = msg.body || "";
  const data = { url: msg.url || "/budgets" };
  // renotify: a notification that replaces one with the same tag (100% after
  // 80%) still alerts; without it Android swaps it in silently.
  const options = msg.tag ? { body, tag: msg.tag, renotify: true, icon: "/icons/192", data } : { body, icon: "/icons/192", data };

  event.waitUntil(
    (async () => {
      let result = "shown";
      try {
        await self.registration.showNotification(title, options);
      } catch (e) {
        // Still show the alert, plainer (no icon, no tag).
        try {
          await self.registration.showNotification(title, { body, data });
          result = `shown without icon (${e && e.message})`;
        } catch (e2) {
          result = `failed: ${(e2 && e2.message) || e2}`;
        }
      }
      let showing = null;
      try {
        showing = (await self.registration.getNotifications()).length;
      } catch {}
      // Lets Settings → Budget alerts report what happened while it's open.
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const permission = typeof Notification !== "undefined" ? Notification.permission : null;
      wins.forEach((w) => w.postMessage({ type: "push-received", tag: msg.tag || null, result, showing, permission }));
    })(),
  );
});

// Tapping it opens the app on Budgets, reusing an open window if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/budgets", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) return win.navigate(url).then((w) => (w || win).focus());
      return self.clients.openWindow(url);
    }),
  );
});
