/**
 * Push providers (Epic 9.4). One interface for APNs, FCM, WNS and Web Push.
 *
 * Messages carry the translation key + params, never rendered text: APNs
 * (`loc-key`/`loc-args`) and FCM (`body_loc_key`) localise on the device, and
 * WNS/Web Push service workers render with the app's bundled strings. The
 * device's `locale` is passed for adapters that must render server-side.
 *
 * Real adapters (push/senders) need owner credentials from Secrets Store (APNs
 * .p8 key, Firebase service account, WNS package secret; issue #414). Until a
 * provider's secrets are set, it falls back to LogOnlyPushProvider.
 */
import type { NotificationCategory, NotificationKey, NotificationParams } from '@al-ummah/shared-types';
import { logger } from '../lib/logger';
import { ApnsPushProvider, type ApnsEnv } from './senders/apns';
import { FcmPushProvider, type FcmEnv } from './senders/fcm';
import { WnsPushProvider, type WnsEnv } from './senders/wns';

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

/**
 * A review alert for the staff Admin app (src/review-alerts). Rendered text only: "Video held
 * for review · <reason> · <n> min left". Never a title, channel, thumbnail or media URL.
 * - alert: a visible, time-sensitive notification (APNs interruption-level time-sensitive,
 *   FCM high priority on the `review_queue` channel, a WNS toast in the review group)
 * - clear: silent; the app removes the alert for `reviewId` (claimed or decided elsewhere)
 */
export interface AlertPush {
  kind: 'alert' | 'clear';
  /** The review item: deep link, collapse id / tag, and what a clear removes. */
  reviewId: string;
  title?: string;
  body?: string;
  /** Notification action labels in the device's language (Approve and reject are never offered). */
  openLabel?: string;
  claimLabel?: string;
  /** Opened by the notification's Open action. */
  actionUrl?: string;
  /** How long the push is worth delivering (s): a late alert is noise. */
  ttlSeconds: number;
}

export interface PushProvider {
  readonly name: string;
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
  sendAlert(target: PushTarget, alert: AlertPush): Promise<PushResult>;
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
  async sendAlert(target: PushTarget, alert: AlertPush): Promise<PushResult> {
    logger.debug('Review alert push (log-only)', {
      provider: target.provider,
      app: target.app,
      installId: target.installId,
      reviewId: alert.reviewId,
      kind: alert.kind,
    });
    return { ok: true };
  }
}

export type PushProviders = Record<PushProviderName, PushProvider>;

/** Secrets Store bindings of the senders (wrangler configs); a missing one keeps that provider log-only. */
export type PushSenderEnv = ApnsEnv & FcmEnv & WnsEnv;

/**
 * The provider per push service. APNs, FCM and WNS send for real once their secrets are set
 * (#414); until then, and always without an env (tests), they are log-only. Web Push stays
 * log-only (VAPID keys and payload encryption are their own issue).
 */
export function resolvePushProviders(env?: PushSenderEnv): PushProviders {
  const logOnly = new LogOnlyPushProvider();
  if (!env) return { apns: logOnly, fcm: logOnly, wns: logOnly, webpush: logOnly };
  return {
    apns: new ApnsPushProvider(env, logOnly),
    fcm: new FcmPushProvider(env, logOnly),
    wns: new WnsPushProvider(env, logOnly),
    webpush: logOnly,
  };
}
