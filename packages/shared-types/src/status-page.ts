/**
 * Public status page (apps/status, docs/status-page/README.md): the components
 * it monitors, their states and the incident model. Shared by the status
 * Worker (checks + public page), admin-api (incident writes, STATUS_DB) and
 * the videos admin's Status page.
 */

/**
 * Monitored components, in the order the pages list them. `public`: shown on the public status
 * page, its JSON and feeds. The rest are internal (staff tools, back ends, providers): checked and
 * alerted on the same way, shown only on the videos admin's Status page (owner, 2026-11-13: "You
 * shouldn't show admin status unless this page is only for admins").
 */
export const STATUS_COMPONENTS = [
  { id: 'www', en: 'Website', ar: 'الموقع', public: true },
  { id: 'videos', en: 'Videos site', ar: 'موقع المرئيات', public: true },
  { id: 'signin', en: 'Sign-in', ar: 'تسجيل الدخول', public: true },
  { id: 'profile', en: 'Profile', ar: 'الملف الشخصي', public: true },
  { id: 'uploads', en: 'Uploads', ar: 'رفع المرئيات', public: true },
  { id: 'playback', en: 'Playback', ar: 'تشغيل المرئيات', public: true },
  { id: 'live', en: 'Live streaming', ar: 'البث المباشر', public: true },
  { id: 'realtime', en: 'Notifications & realtime', ar: 'الإشعارات والتحديثات الفورية', public: true },
  { id: 'search', en: 'Search', ar: 'البحث', public: true },
  { id: 'api', en: 'Videos API', ar: 'واجهة المرئيات البرمجية', public: false },
  { id: 'cms', en: 'CMS', ar: 'نظام إدارة المحتوى', public: false },
  { id: 'admin', en: 'Videos admin', ar: 'إدارة المرئيات', public: false },
  { id: 'admin-api', en: 'Admin API', ar: 'واجهة الإدارة البرمجية', public: false },
  { id: 'auth-admin', en: 'Accounts admin', ar: 'إدارة الحسابات', public: false },
  { id: 'email', en: 'Email', ar: 'البريد الإلكتروني', public: false },
] as const;

export type StatusComponentId = (typeof STATUS_COMPONENTS)[number]['id'];
export const STATUS_COMPONENT_IDS: readonly StatusComponentId[] = STATUS_COMPONENTS.map((c) => c.id);

/** Components the public page, JSON and feeds show. */
export const PUBLIC_STATUS_COMPONENT_IDS: readonly StatusComponentId[] = STATUS_COMPONENTS.filter((c) => c.public).map((c) => c.id);

export function isPublicStatusComponent(id: string): boolean {
  return (PUBLIC_STATUS_COMPONENT_IDS as readonly string[]).includes(id);
}

export function isStatusComponentId(v: unknown): v is StatusComponentId {
  return typeof v === 'string' && (STATUS_COMPONENT_IDS as readonly string[]).includes(v);
}

/** A component's state, worst last. `maintenance` only comes from a maintenance window. */
export const COMPONENT_STATES = ['operational', 'maintenance', 'degraded', 'partial', 'major'] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

export const INCIDENT_KINDS = ['incident', 'maintenance'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'completed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number] | (typeof MAINTENANCE_STATUSES)[number];

/** How badly an incident affects its components (shown on them while it is open). */
export const INCIDENT_IMPACTS = ['none', 'degraded', 'partial', 'major'] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number] | 'maintenance';

/** Statuses that close an incident / maintenance. */
export function isClosedStatus(status: string): boolean {
  return status === 'resolved' || status === 'completed';
}

export function statusesFor(kind: IncidentKind): readonly IncidentStatus[] {
  return kind === 'maintenance' ? MAINTENANCE_STATUSES : INCIDENT_STATUSES;
}

/** Status labels, en + ar (public page, feed and admin). */
export const STATUS_LABELS: Record<ComponentState | IncidentStatus | 'none', { en: string; ar: string }> = {
  operational: { en: 'Operational', ar: 'يعمل' },
  maintenance: { en: 'Under maintenance', ar: 'قيد الصيانة' },
  degraded: { en: 'Degraded performance', ar: 'أداء منخفض' },
  partial: { en: 'Partial outage', ar: 'انقطاع جزئي' },
  major: { en: 'Major outage', ar: 'انقطاع كبير' },
  none: { en: 'No impact', ar: 'بلا تأثير' },
  investigating: { en: 'Investigating', ar: 'قيد التحقيق' },
  identified: { en: 'Identified', ar: 'تم تحديد السبب' },
  monitoring: { en: 'Monitoring', ar: 'قيد المراقبة' },
  resolved: { en: 'Resolved', ar: 'تم الحل' },
  scheduled: { en: 'Scheduled', ar: 'مجدولة' },
  in_progress: { en: 'In progress', ar: 'جارية' },
  completed: { en: 'Completed', ar: 'اكتملت' },
};

/** Field limits for incident text (admin-api validates; the admin form shows them). */
export const STATUS_TEXT_LIMITS = { title: 140, body: 4000 } as const;

/** Public status page host per environment. */
export const STATUS_PAGE_URLS = {
  production: 'https://status.alummahnow.net',
  stage: 'https://status.stage.alummahnow.net',
  qa: 'https://status.qa.alummahnow.net',
} as const;
