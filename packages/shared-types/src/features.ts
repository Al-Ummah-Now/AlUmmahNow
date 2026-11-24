/**
 * Which user-facing features this person sees (owner rule 2026-11-16, wiki
 * "Product rules → Hidden when off").
 *
 * A feature that is switched off, not configured (missing provider key, OAuth
 * client, secret or binding) or not in the user's creator tier is invisible:
 * no tab, nav item, button, link, help entry, sitemap entry or empty state,
 * and no "not available / not in your tier / upgrade" text. The only upgrade
 * entry points are the header Upgrade button and /upgrade. Running out of a
 * quota (hours, minutes, uploads, channels) is different: a plain fact at the
 * moment of the action, without an upsell.
 *
 * One server-computed source: api-videos GET /api/me/features (optionally
 * ?channelId= for features evaluated against that channel's owner's tier and
 * the caller's role there). Web, Apple, Android and Desktop all read it.
 * A key a client does not know, or that is missing, means hidden.
 *
 * A gated API whose feature is off answers 404 FEATURE_OFF_BODY, with no
 * user-facing message; a client treats it as "hide this entry point".
 */

export const USER_FEATURE_KEYS = [
  /** The creator tier allows uploads (own channels or a channel whose owner's tier does) */
  'upload',
  /** The creator tier allows owning channels (the channel limit is a quota, said at the action) */
  'createChannel',
  /** A live provider is on and configured, and the (channel owner's) tier includes live */
  'live',
  /** Moderated live chat and VOD chat replay on live streams and premieres (switch liveChat, wiki E17) */
  'liveChat',
  /** Scheduling an uploaded video as a live premiere with countdown (switch livePremieres, wiki E17) */
  'livePremieres',
  /** Viewer reminders and calendar export on scheduled streams and premieres (switch liveReminders, wiki E17) */
  'liveReminders',
  /** Community event stream tags and filters (Jumu’ah, Taraweeh, conference, halqa; switch liveEvents, wiki E17) */
  'liveEvents',
  /** Transcription can run here, and the plan has caption minutes (tier, grants or packs) */
  'captionsTranscribe',
  /** Caption translation is switched on (admin) */
  'captionsTranslate',
  /** The Translate button beside titles and descriptions is switched on (admin) */
  'inlineTranslate',
  /** Viewer-side translated titles are on for the whole site (admin) */
  'viewerTranslatedTitles',
  /**
   * Viewers may download a video's captions from the player (admin; off by default, owner decision
   * 2026-11-22). Off: the player shows no Download row, and the download API serves only the video's
   * owner, its channel's caption editors and admins (Studio)
   */
  'viewerCaptionDownload',
  /** Quran Foundation translation editions can be loaded (credentials bound) */
  'quranEditions',
  /** Our Quran Foundation copy of the official text is synced and fresh (quran/current.json) */
  'quranText',
  /** The (channel owner's) tier allows extra audio tracks */
  'audioTracks',
  /** Own domains: Cloudflare for SaaS is set up, and the channel's site allows at least one */
  'siteDomains',
  /** Social auto-post: switched on and at least one network configured and on */
  'socialAutopost',
  /** Move from YouTube: switched on, Google client id and secret present */
  'youtubeImport',
  /** AI category suggestions on the upload and edit forms */
  'aiCategorySuggest',
  /** Bulk scheduling in Studio Videos */
  'bulkSchedule',
  /** Viewers may send creator support (one-time or monthly; switch creatorSupport, wiki MEMBERS) */
  'support',
  /** The caller's channel may receive creator support (switch creatorSupport) */
  'supportReceive',
  /** Supporter perks can be offered and shown (switch supportPerks) */
  'supportPerks',
  /** Viewers may browse the upcoming event calendar and calendar feeds (switch eventCalendar) */
  'eventCalendar',
  /** Settings › Billing: a payment provider is on, or the account has subscriptions or payments (wiki AUN-SUBS) */
  'billing',
  /** Audio-first Listen mode, mini audio bar, sleep timer and background audio (wiki E14) */
  'listenMode',
  /** Encrypted offline downloads on native apps and creator download settings (wiki E14) */
  'offlineDownloads',
  /** E21: every entry is off until its feature switch and implementation readiness turn it on */
  'prayerTimes',
  'qibla',
  'hijriCalendar',
  'ramadanMode',
  /** Reading recitation tools; text still needs a fresh Quran Foundation copy */
  'recitationTools',
  /** Editing reciter metadata, separately gated by the channel owner's tier and video.edit */
  'recitationMetadata',
  'intentionalViewing',
  /** Private time-stamped notes; signed-in viewers only, note limit per admin-managed tier */
  'studyNotes',
] as const;

export type UserFeatureKey = (typeof USER_FEATURE_KEYS)[number];

export type UserFeatures = Record<UserFeatureKey, boolean>;

export const USER_FEATURES_VERSION = 1;

export interface UserFeaturesResponse {
  success: true;
  version: typeof USER_FEATURES_VERSION;
  features: UserFeatures;
}

/** Every feature hidden: what a client uses while it cannot read the answer (fail closed). */
export const NO_FEATURES: UserFeatures = Object.freeze(
  Object.fromEntries(USER_FEATURE_KEYS.map((key) => [key, false])) as UserFeatures,
) as UserFeatures;

/** Reads an answer defensively: anything but `true` is hidden, unknown keys are dropped. */
export function parseUserFeatures(raw: unknown): UserFeatures {
  const source = raw && typeof raw === 'object' ? ((raw as { features?: unknown }).features ?? raw) : null;
  const value = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>;
  return Object.fromEntries(USER_FEATURE_KEYS.map((key) => [key, value[key] === true])) as UserFeatures;
}

/** The code a gated API answers (404) while its feature is off for the caller. */
export const FEATURE_OFF_CODE = 'feature_off';
export const FEATURE_OFF_BODY = Object.freeze({ success: false as const, code: FEATURE_OFF_CODE });

/** True for a 404 feature_off answer (`body` is the parsed JSON). */
export function isFeatureOff(status: number, body: unknown): boolean {
  return status === 404 && !!body && typeof body === 'object' && (body as { code?: unknown }).code === FEATURE_OFF_CODE;
}
