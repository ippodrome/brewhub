export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

// Web Push's applicationServerKey wants a raw Uint8Array, but the backend
// hands out the VAPID public key as a base64url string (web-push's own
// generateVAPIDKeys() format) — standard conversion, same one used in every
// web-push tutorial.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function toSubscriptionJson(sub: PushSubscription): PushSubscriptionJson {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Browser returned an incomplete push subscription");
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

export async function getCurrentSubscription(): Promise<PushSubscriptionJson | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await registration?.pushManager.getSubscription();
  return sub ? toSubscriptionJson(sub) : null;
}

/** Registers the service worker (idempotent), requests notification permission, and subscribes. Throws if permission is denied. */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionJson> {
  if (!isPushSupported()) {
    throw new Error("Push notifications aren't supported in this browser");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was denied");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const sub =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // TS's DOM lib types Uint8Array generically over its buffer type as of
      // TS 5.7+, which PushSubscriptionOptionsInit's BufferSource doesn't
      // structurally accept without a cast — the runtime value is a plain
      // Uint8Array either way, this is a lib-types granularity mismatch.
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  return toSubscriptionJson(sub);
}

export async function unsubscribeFromPushLocally(): Promise<string | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  const sub = await registration?.pushManager.getSubscription();
  if (!sub) return null;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
