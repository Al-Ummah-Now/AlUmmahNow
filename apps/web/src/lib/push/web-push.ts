'use client';

/**
 * Browser notifications (Web Push, #1287) for the signed-in viewer.
 *
 * Turning them on: notification permission (from the click), the push service worker
 * (/push-sw.js, scope /push/), a PushManager subscription with the environment's VAPID public
 * key (GET /api/devices/webpush-key), then PUT /api/devices/:installId with provider
 * 'webpush'. This browser's install id lives in localStorage; so does the id of the user who
 * turned them on, so a page load refreshes only that user's registration (subscription or
 * language changes) and signing out removes it (a shared browser stops getting that
 * account's notifications).
 *
 * Which notifications arrive follows the account's notification settings, like every device.
 */
import { logger } from '@/lib/logger-client';
import { getApiUrl } from '@/lib/runtime-config';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { PUSH_SW_PATH, PUSH_SW_SCOPE } from './service-worker-paths';

export type WebPushState =
  /** No service worker / PushManager / Notification here (iOS Safari outside a Home Screen app). */
  | 'unsupported'
  /** The environment has no VAPID key pair: nothing to offer. */
  | 'unavailable'
  /** The user blocked notifications for this site. */
  | 'denied'
  | 'off'
  | 'on';

const INSTALL_KEY = 'aun_push_install';
const OWNER_KEY = 'aun_push_owner';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isWebPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone / iPad Safari: Web Push only in a Home Screen app. */
export function isIosOutsideHomeScreen(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !standalone;
}

/** This browser's install id (api-videos InstallIdSchema: 8-64 of [A-Za-z0-9_-]). */
export function installId(): string {
  const store = storage();
  const existing = store?.getItem(INSTALL_KEY);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  store?.setItem(INSTALL_KEY, id);
  return id;
}

let keyPromise: Promise<string | null> | null = null;

/** The VAPID public key, or null when this environment has none (or the API is unreachable). */
export function webPushPublicKey(): Promise<string | null> {
  keyPromise ??= (async () => {
    try {
      const res = await fetch(`${getApiUrl()}/api/devices/webpush-key`);
      if (!res.ok) return null;
      const body = (await res.json()) as { result?: { publicKey?: string | null } };
      return body.result?.publicKey ?? null;
    } catch (error) {
      logger.warn('[WebPush] Public key request failed', { error });
      return null;
    }
  })();
  const pending = keyPromise;
  // A failure is not remembered: the next visit asks again
  void pending.then((key) => {
    if (key === null && keyPromise === pending) keyPromise = null;
  });
  return pending;
}

/** Test seam: forget the cached key. */
export function resetWebPushKeyCache(): void {
  keyPromise = null;
}

export function applicationServerKey(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function devicesRequest(method: 'PUT' | 'DELETE', body?: unknown): Promise<boolean> {
  try {
    const headers: Record<string, string> = { ...(await getClientAuthHeaders()) };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${getApiUrl()}/api/devices/${encodeURIComponent(installId())}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      keepalive: method === 'DELETE',
    });
    // A DELETE of a row that is already gone is fine
    if (res.ok || (method === 'DELETE' && res.status === 404)) return true;
    logger.warn('[WebPush] Device request failed', { method, status: res.status });
    return false;
  } catch (error) {
    logger.warn('[WebPush] Device request error', { method, error });
    return false;
  }
}

function register(subscription: PushSubscription, lang: string): Promise<boolean> {
  return devicesRequest('PUT', {
    platform: 'web',
    provider: 'webpush',
    app: 'viewer',
    subscription: subscription.toJSON(),
    locale: lang === 'ar' ? 'ar' : 'en',
  });
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** What the settings switch shows for `userId`. */
export async function webPushState(userId: string): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  if (!(await webPushPublicKey())) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  try {
    return (await currentSubscription()) && storage()?.getItem(OWNER_KEY) === userId ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Called from the switch's click (the permission prompt needs the user's gesture). */
export async function enableWebPush(userId: string, lang: string): Promise<WebPushState | 'error'> {
  if (!isWebPushSupported()) return 'unsupported';
  const key = await webPushPublicKey();
  if (!key) return 'unavailable';
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  try {
    const registration = await navigator.serviceWorker.register(PUSH_SW_PATH, { scope: PUSH_SW_SCOPE });
    await navigator.serviceWorker.ready.catch(() => undefined);
    const wanted = applicationServerKey(key);
    let subscription = await registration.pushManager.getSubscription();
    // A subscription made with another key (the pair was replaced) can never receive: renew it
    const subscribedKey = subscription?.options.applicationServerKey;
    if (subscription && subscribedKey && !sameBytes(new Uint8Array(subscribedKey), wanted)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted as BufferSource });
    if (!(await register(subscription, lang))) return 'error';
    storage()?.setItem(OWNER_KEY, userId);
    return 'on';
  } catch (error) {
    logger.error('[WebPush] Turning on failed', { error });
    return 'error';
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The switch turned off: no more pushes to this browser. */
export async function disableWebPush(): Promise<boolean> {
  if (!(await devicesRequest('DELETE'))) return false;
  storage()?.removeItem(OWNER_KEY);
  try {
    await (await currentSubscription())?.unsubscribe();
  } catch (error) {
    logger.warn('[WebPush] Unsubscribe failed', { error });
  }
  return true;
}

/**
 * On a page load of the user who turned them on: re-register (idempotent), so a rotated
 * subscription or a new site language reaches the server. Never prompts.
 */
export async function syncWebPush(userId: string, lang: string): Promise<void> {
  if (!isWebPushSupported() || Notification.permission !== 'granted') return;
  if (storage()?.getItem(OWNER_KEY) !== userId) return;
  try {
    const subscription = await currentSubscription();
    if (subscription) await register(subscription, lang);
    else storage()?.removeItem(OWNER_KEY);
  } catch (error) {
    logger.warn('[WebPush] Sync failed', { error });
  }
}

/** Before signing out (the token still works): this browser stops getting the account's pushes. */
export async function stopWebPushOnSignOut(): Promise<void> {
  if (typeof window === 'undefined' || !storage()?.getItem(OWNER_KEY)) return;
  await Promise.race([disableWebPush(), new Promise((resolve) => setTimeout(resolve, 3000))]);
}
