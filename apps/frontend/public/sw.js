// Minimal push-notification service worker — no offline caching, no asset
// precaching. BrewHub isn't trying to be an offline-first PWA, this file
// exists solely so the Push API has a registration to attach to.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "BrewHub", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "BrewHub", {
      body: payload.body ?? "",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
