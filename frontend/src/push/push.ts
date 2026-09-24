import { api } from '../api/client';

// Push-Nachrichten im Browser: nur mit Service Worker, also über HTTPS (oder
// localhost); auf dem iPhone erst, wenn die App auf dem Home-Bildschirm liegt.
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

function supported() {
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Zum Einschalten: auf den Service Worker warten, aber nicht ewig
// (im Entwicklungsserver gibt es keinen)
async function readyRegistration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
  ]);
}

// Für Status und Abmelden: sofort, ohne zu warten
const currentRegistration = () => navigator.serviceWorker.getRegistration().catch(() => undefined);

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !standalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = (await currentRegistration()) ?? (await readyRegistration());
  if (!reg) return 'unsupported';
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

// Schlüssel des Servers (Base64url) als Bytes für pushManager.subscribe
function keyBytes(base64url: string) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await readyRegistration();
  if (!reg) return 'unsupported';
  const { publicKey } = await api.get<{ publicKey: string }>('/push/public-key');
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.post('/push/subscribe', subscription.toJSON());
  return 'on';
}

// Beim Abmelden und auf Wunsch: das Gerät bekommt nichts mehr
export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const reg = await currentRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await api.delete('/push/subscribe', { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
