/**
 * Push providers (Epic 9.4). One interface for APNs, FCM, WNS and Web Push.
 *
 * Messages carry the translation key + params, never rendered text: APNs
 * (`loc-key`/`loc-args`) and FCM (`body_loc_key`) localise on the device, and
 * WNS/Web Push service workers render with the app's bundled strings. The
 * device's `locale` is passed for adapters that must render server-side.
 *
 * Real adapters need owner credentials (APNs .p8 key, Firebase service
 * account, WNS package secret, VAPID keys; issue #414). Until a provider's
 * credentials exist it is served by LogOnlyPushProvider.
 */
import type { NotificationCategory, NotificationKey, NotificationParams } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';

export type PushProviderName = 'apns' | 'fcm' | 'wns' | 'webpush';
/** The app that registered the device (push_devices.app, #1264): picks the APNs topic. */
export type PushApp = 'viewer' | 'studio' | 'admin';
/** Ordinary notifications reach these apps; the staff Admin app only gets review alerts. */
export const NOTIFICATION_APPS: readonly PushApp[] = ['viewer', 'studio'];

export interface PushTarget {
  installId: string;
  userId: string;
  app: PushApp;
  platform: string;
  provider: PushProviderName;
  /** Device token, WNS channel URI, or Web Push subscription JSON. */
  token: string;
  locale: string | null;
}

export interface PushMessage {
  notificationId: string;
  notificationKey: NotificationKey;
  category: NotificationCategory;
  params: NotificationParams;
  actionUrl?: string;
}

export type PushResult =
  | { ok: true }
  /** invalidToken: the provider says the token is gone (410 / Unregistered); the device row is deleted. */
  | { ok: false; invalidToken: boolean; error: string };

export interface PushProvider {
  readonly name: string;
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

/** Stand-in until a provider's credentials are configured: records what would be sent. */
export class LogOnlyPushProvider implements PushProvider {
  readonly name = 'log-only';
  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    logger.debug('Push (log-only)', {
      provider: target.provider,
      platform: target.platform,
      installId: target.installId,
      notificationId: message.notificationId,
      key: message.notificationKey,
    });
    return { ok: true };
  }
}

export type PushProviders = Record<PushProviderName, PushProvider>;

/** The provider per push service. Every service is log-only until its adapter and credentials land. */
export function resolvePushProviders(): PushProviders {
  const logOnly = new LogOnlyPushProvider();
  return { apns: logOnly, fcm: logOnly, wns: logOnly, webpush: logOnly };
}
