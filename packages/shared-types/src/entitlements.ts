/**
 * Plans & entitlements catalogue and resolver (Epic 27).
 *
 * The catalogue is the single registry of entitlement keys: admins can only set
 * keys listed here. Actual plan values live in D1 and are edited in admin-web.
 *
 * `fallback` is what a key resolves to when no plan supplies it, including when
 * D1 is unavailable. It is deliberately permissive: an outage must not lock
 * creators out. The limits on the Free plan are seeded by migration instead.
 */

export const UNLIMITED = 'unlimited' as const;
export type EntitlementValue = boolean | number | string | string[];
export type EntitlementType = 'boolean' | 'number' | 'enum' | 'list';
export type SubjectType = 'channel' | 'organisation' | 'user';

export interface Subject {
  type: SubjectType;
  id: string;
}

export interface EntitlementDefinition {
  key: string;
  type: EntitlementType;
  unit?: string;
  options?: readonly string[];
  fallback: EntitlementValue;
  epic: number;
  description_en: string;
  description_ar: string;
  /** Behaviour when the limit is reached. */
  at_limit: string;
}

const theming = ['light_dark', 'colours', 'fonts', 'full'] as const;

export const ENTITLEMENT_CATALOGUE: readonly EntitlementDefinition[] = [
  { key: 'channel.max', type: 'number', unit: 'channels', fallback: UNLIMITED, epic: 27, description_en: 'Channels a user can own', description_ar: 'عدد القنوات التي يمكن للمستخدم امتلاكها', at_limit: 'New channel refused; existing channels are kept' },
  { key: 'channel.handle', type: 'boolean', fallback: true, epic: 29, description_en: 'Claim and change a channel @handle', description_ar: 'حجز وتغيير معرّف القناة @', at_limit: 'n/a' },
  { key: 'channel.about.links.max', type: 'number', unit: 'links', fallback: 10, epic: 29, description_en: 'Links on the channel About tab', description_ar: 'الروابط في تبويب "حول" للقناة', at_limit: 'Adding links refused; existing links can stay' },
  { key: 'comments.replies', type: 'boolean', fallback: true, epic: 29, description_en: 'Replies on video comments', description_ar: 'الردود على تعليقات الفيديو', at_limit: 'n/a' },
  { key: 'comments.settings', type: 'boolean', fallback: true, epic: 29, description_en: 'Per-video comment settings', description_ar: 'إعدادات التعليقات لكل فيديو', at_limit: 'n/a' },
  { key: 'comments.heldForReview', type: 'boolean', fallback: true, epic: 29, description_en: 'Hold comments for review', description_ar: 'تعليق التعليقات للمراجعة', at_limit: 'n/a' },
  { key: 'upload.monthlyUploads', type: 'number', unit: 'uploads', fallback: UNLIMITED, epic: 27, description_en: 'New video uploads per calendar month', description_ar: 'عدد الفيديوهات الجديدة في الشهر', at_limit: 'New upload refused until next month' },
  { key: 'upload.maxDurationMinutes', type: 'number', unit: 'minutes', fallback: UNLIMITED, epic: 27, description_en: 'Maximum length of a new video', description_ar: 'أقصى مدة للفيديو الجديد', at_limit: 'New upload refused; existing videos are kept' },
  { key: 'upload.monthlyHours', type: 'number', unit: 'hours', fallback: UNLIMITED, epic: 27, description_en: 'Hours of video uploaded per month', description_ar: 'ساعات الفيديو المرفوعة شهرياً', at_limit: 'Not enforced yet' },
  { key: 'storage.gb', type: 'number', unit: 'GB', fallback: UNLIMITED, epic: 27, description_en: 'Video storage', description_ar: 'مساحة تخزين الفيديو', at_limit: 'New upload refused; existing videos are kept' },
  { key: 'live.monthlyMinutes', type: 'number', unit: 'minutes', fallback: UNLIMITED, epic: 27, description_en: 'Live streaming minutes per month', description_ar: 'دقائق البث المباشر شهرياً', at_limit: 'Not enforced yet' },
  { key: 'analytics.retentionDays', type: 'number', unit: 'days', fallback: UNLIMITED, epic: 27, description_en: 'Analytics history', description_ar: 'مدة الاحتفاظ بالإحصاءات', at_limit: 'Not enforced yet' },
  { key: 'studio.bulkImport', type: 'boolean', fallback: true, epic: 27, description_en: 'Bulk import in Studio', description_ar: 'الاستيراد المجمّع في الاستوديو', at_limit: 'Not enforced yet' },
  { key: 'studio.teamSeats', type: 'number', unit: 'seats', fallback: UNLIMITED, epic: 27, description_en: 'Studio team seats', description_ar: 'مقاعد فريق الاستوديو', at_limit: 'Not enforced yet' },
  { key: 'share.shortLinks', type: 'boolean', fallback: true, epic: 25, description_en: 'Short share links', description_ar: 'روابط المشاركة القصيرة', at_limit: 'n/a' },
  { key: 'embed.enabled', type: 'boolean', fallback: true, epic: 25, description_en: 'Embed videos on other sites', description_ar: 'تضمين الفيديوهات في مواقع أخرى', at_limit: 'n/a' },
  { key: 'embed.domains.max', type: 'number', unit: 'domains', fallback: UNLIMITED, epic: 25, description_en: 'Domains per restricted video', description_ar: 'النطاقات لكل فيديو مقيّد', at_limit: 'Feature not built' },
  { key: 'embed.customColor', type: 'boolean', fallback: false, epic: 25, description_en: 'Custom player colour', description_ar: 'لون مخصص للمشغّل', at_limit: 'Feature not built' },
  { key: 'embed.hideBranding', type: 'boolean', fallback: false, epic: 25, description_en: 'Hide player branding', description_ar: 'إخفاء العلامة في المشغّل', at_limit: 'Feature not built' },
  { key: 'embed.privateVideos', type: 'boolean', fallback: false, epic: 25, description_en: 'Signed embeds of private videos', description_ar: 'تضمين موقّع للفيديوهات الخاصة', at_limit: 'Feature not built' },
  { key: 'embed.analytics.retentionDays', type: 'number', unit: 'days', fallback: 28, epic: 25, description_en: 'Embed analytics history', description_ar: 'مدة إحصاءات التضمين', at_limit: 'Feature not built' },
  { key: 'sites.max', type: 'number', unit: 'sites', fallback: UNLIMITED, epic: 26, description_en: 'Registered sites', description_ar: 'المواقع المسجلة', at_limit: 'Feature not built' },
  { key: 'discussions.pageThreads', type: 'number', unit: 'pages', fallback: UNLIMITED, epic: 26, description_en: 'Comments-only page threads', description_ar: 'صفحات التعليقات فقط', at_limit: 'Feature not built' },
  { key: 'discussions.monthlyComments', type: 'number', unit: 'comments', fallback: UNLIMITED, epic: 26, description_en: 'Widget comments per month', description_ar: 'تعليقات الأداة شهرياً', at_limit: 'Feature not built' },
  { key: 'discussions.guestPosting', type: 'boolean', fallback: false, epic: 26, description_en: 'Pre-moderated guest posting', description_ar: 'نشر الزوار بعد المراجعة', at_limit: 'Feature not built' },
  { key: 'discussions.theming', type: 'enum', options: theming, fallback: 'light_dark', epic: 26, description_en: 'Widget theming level', description_ar: 'مستوى تخصيص مظهر الأداة', at_limit: 'Feature not built' },
  { key: 'discussions.moderators.max', type: 'number', unit: 'moderators', fallback: UNLIMITED, epic: 26, description_en: 'Moderators per site', description_ar: 'المشرفون لكل موقع', at_limit: 'Feature not built' },
  { key: 'discussions.filters.advanced', type: 'boolean', fallback: false, epic: 26, description_en: 'Advanced moderation filters', description_ar: 'مرشحات الإشراف المتقدمة', at_limit: 'Feature not built' },
  { key: 'discussions.export', type: 'boolean', fallback: false, epic: 26, description_en: 'Export discussions', description_ar: 'تصدير النقاشات', at_limit: 'Feature not built' },
  { key: 'discussions.webhooks', type: 'boolean', fallback: false, epic: 26, description_en: 'Discussion webhooks', description_ar: 'خطافات ويب للنقاشات', at_limit: 'Feature not built' },
  { key: 'discussions.ssr.snapshot', type: 'boolean', fallback: false, epic: 26, description_en: 'Server-rendered snapshot', description_ar: 'لقطة معروضة من الخادم', at_limit: 'Feature not built' },
];

const byKey = new Map(ENTITLEMENT_CATALOGUE.map((d) => [d.key, d]));

export function getEntitlementDefinition(key: string): EntitlementDefinition | undefined {
  return byKey.get(key);
}

/** Validates a value against the catalogue. Returns an error message, or null when valid. */
export function validateEntitlementValue(key: string, value: unknown): string | null {
  const def = byKey.get(key);
  if (!def) return `Unknown entitlement key: ${key}`;
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? null : `${key} must be true or false`;
    case 'number':
      if (value === UNLIMITED) return null;
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? null : `${key} must be a whole number of 0 or more, or "${UNLIMITED}"`;
    case 'enum':
      return typeof value === 'string' && def.options?.includes(value) ? null : `${key} must be one of ${def.options?.join(', ')}`;
    case 'list':
      return Array.isArray(value) && value.every((v) => typeof v === 'string') ? null : `${key} must be a list of strings`;
  }
}

export interface EntitlementOverride {
  key: string;
  value: EntitlementValue;
  expires_at: string | null;
}

export type EntitlementSource = 'override' | 'subscription' | 'default_plan' | 'fallback';

export interface ResolveInput {
  /** Overrides for the subject, then its owner; the first match for a key wins. */
  overrides: readonly EntitlementOverride[];
  /** Values from the subject's live subscription version, if any. */
  subscription: Readonly<Record<string, EntitlementValue>> | null;
  /** Values from the default plan's latest version. */
  defaultPlan: Readonly<Record<string, EntitlementValue>> | null;
  now: Date;
}

export interface ResolvedEntitlement {
  value: EntitlementValue;
  source: EntitlementSource;
}

/** Precedence: unexpired override > live subscription > default plan > catalogue fallback. */
export function resolveEntitlements(input: ResolveInput): Record<string, ResolvedEntitlement> {
  const overrides = new Map<string, EntitlementValue>();
  for (const o of input.overrides) {
    if (o.expires_at && new Date(o.expires_at).getTime() <= input.now.getTime()) continue;
    if (!overrides.has(o.key)) overrides.set(o.key, o.value);
  }
  const resolved: Record<string, ResolvedEntitlement> = {};
  for (const def of ENTITLEMENT_CATALOGUE) {
    if (overrides.has(def.key)) resolved[def.key] = { value: overrides.get(def.key)!, source: 'override' };
    else if (input.subscription && def.key in input.subscription) resolved[def.key] = { value: input.subscription[def.key], source: 'subscription' };
    else if (input.defaultPlan && def.key in input.defaultPlan) resolved[def.key] = { value: input.defaultPlan[def.key], source: 'default_plan' };
    else resolved[def.key] = { value: def.fallback, source: 'fallback' };
  }
  return resolved;
}

export interface LimitDecision {
  allowed: boolean;
  limit: number | typeof UNLIMITED;
}

/**
 * Decides whether `current + adding` fits under a numeric limit.
 *
 * Grandfathering: this only ever refuses growth. `adding <= 0` is always
 * allowed, so someone already above a limit keeps what they have and may
 * reduce it; they just cannot add more.
 */
export function checkNumericLimit(value: EntitlementValue, current: number, adding: number): LimitDecision {
  if (value === UNLIMITED || typeof value !== 'number') return { allowed: true, limit: UNLIMITED };
  if (adding <= 0) return { allowed: true, limit: value };
  return { allowed: current + adding <= value, limit: value };
}

/** The body of every entitlement refusal (HTTP 402). */
export interface UpgradeRequiredError {
  success: false;
  error: 'upgrade_required';
  entitlement: string;
  limit: number | typeof UNLIMITED | null;
  current: number | null;
  message: string;
}

export function usagePeriod(now: Date): string {
  return now.toISOString().slice(0, 7);
}
