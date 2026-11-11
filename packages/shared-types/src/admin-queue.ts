/**
 * The admin queues' shared contract (docs/admin/QUEUES.md): every queue the
 * videos admin works through (AI moderation flags, contact messages, errors;
 * reports follow the same shape) has an "Action needed" tab, the items that
 * still need a decision, oldest first, and a "History" tab, the handled items
 * with who did what and when. Both tabs take the same query parameters and
 * answer the same page shape, with the count of each tab for its badge.
 */
import type { AdminSuggestKind } from './admin-content';
import type { ModerationDecision, ModerationSubjectType, ModerationSurface } from './ai-moderation';

export const ADMIN_QUEUE_TABS = ['action', 'history'] as const;
export type AdminQueueTab = (typeof ADMIN_QUEUE_TABS)[number];

/**
 * Sorts every queue offers. `oldest` / `newest` order by the tab's date: when
 * the item came in on "Action needed" (default `oldest`), when it was handled
 * on "History" (default `newest`). Queues add their own (AI: `priority`;
 * errors: `count`, `users`).
 */
export const ADMIN_QUEUE_BASE_SORTS = ['oldest', 'newest'] as const;
export type AdminQueueBaseSort = (typeof ADMIN_QUEUE_BASE_SORTS)[number];

export const ADMIN_QUEUE_DEFAULT_LIMIT = 25;
export const ADMIN_QUEUE_MAX_LIMIT = 100;
/** Longest `q` a queue accepts. */
export const ADMIN_QUEUE_MAX_QUERY = 200;

/**
 * Query parameters every queue reads (GET …/queue). Each is optional; the
 * names mean the same thing on every queue:
 * - `q`: search (live autocomplete and the list use the same parameter)
 * - `tab`: `action` (default) or `history`
 * - `from` / `to`: UTC days (YYYY-MM-DD, inclusive) on the tab's date
 * - `actor`: who handled it (a user id, or `me`); History only
 * - `outcome`: what was done (the queue's outcomes); History only
 * - `type`: the kind of item (AI: surface; errors: error kind)
 * - `category`: the reason (AI: signal category; contact: topic)
 * - `assignee`: `me`, `unassigned` or a user id (contact, errors)
 * - `sort`, `limit`, `offset`: order and page (offset pagination)
 */
export interface AdminQueueQuery {
  q?: string;
  tab?: AdminQueueTab;
  from?: string;
  to?: string;
  actor?: string;
  outcome?: string;
  type?: string;
  category?: string;
  assignee?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

/** Items in each tab under the same filters (tab badges). */
export interface AdminQueueCounts {
  action: number;
  history: number;
}

/**
 * A person shown on a row (author, assignee, who acted). `name` is the display
 * name, else the handle or email; null only when nothing but the id is known
 * (the UI then says "Unknown"). `id` is for links and the actor filter.
 */
export interface AdminQueuePerson {
  id: string | null;
  name: string | null;
}

/** Where a row leads: the UI turns kind + id (+ parentId) into a page link. */
export interface AdminQueueLink {
  kind: AdminSuggestKind;
  id: string;
  /** The video of a comment, the channel of a post */
  parentId?: string | null;
}

/** Who did what and when (History rows; null on "Action needed"). */
export interface AdminQueueHandled<Outcome extends string = string> {
  outcome: Outcome;
  by: AdminQueuePerson | null;
  at: string;
}

/** One page of a queue tab. */
export interface AdminQueuePage<Item> {
  tab: AdminQueueTab;
  items: Item[];
  /** Items in this tab under the filters (= counts[tab]) */
  total: number;
  counts: AdminQueueCounts;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// AI moderation flags (GET /api/moderation/ai/queue)
// ---------------------------------------------------------------------------

export const AI_QUEUE_OUTCOMES = ['agree', 'disagree', 'hide', 'restore'] as const;
export type AiQueueOutcome = (typeof AI_QUEUE_OUTCOMES)[number];
export const AI_QUEUE_SORTS = [...ADMIN_QUEUE_BASE_SORTS, 'priority'] as const;
export type AiQueueSort = (typeof AI_QUEUE_SORTS)[number];

export interface AiQueueItem {
  /** Signal id (GET /api/moderation/ai/signals/:id has the detail) */
  id: string;
  surface: ModerationSurface;
  subjectType: ModerationSubjectType;
  subjectId: string;
  /** The flagged item's title or text (clipped); null when it is gone or not indexed */
  subjectLabel: string | null;
  link: AdminQueueLink | null;
  author: AdminQueuePerson | null;
  channel: { id: string; name: string | null } | null;
  /** Top category (S1–S14 or an extension category) and its score */
  category: string | null;
  score: number | null;
  decision: ModerationDecision;
  priority: number;
  language: string | null;
  createdAt: string;
  handled: AdminQueueHandled<AiQueueOutcome> | null;
}

// ---------------------------------------------------------------------------
// Contact messages (GET /api/contact/queue)
// ---------------------------------------------------------------------------

export const CONTACT_QUEUE_OUTCOMES = ['replied', 'closed', 'spam'] as const;
export type ContactQueueOutcome = (typeof CONTACT_QUEUE_OUTCOMES)[number];
export const CONTACT_QUEUE_SORTS = ADMIN_QUEUE_BASE_SORTS;
export type ContactQueueSort = AdminQueueBaseSort;

export interface ContactQueueItem {
  id: string;
  status: 'new' | 'open' | 'replied' | 'closed' | 'spam';
  topic: string;
  name: string;
  email: string;
  /** The start of the message, one line */
  excerpt: string;
  locale: 'en' | 'ar';
  /** A delivery (notification, acknowledgement or reply) finally failed */
  sendFailed: boolean;
  assignee: AdminQueuePerson | null;
  link: AdminQueueLink;
  createdAt: string;
  updatedAt: string;
  handled: AdminQueueHandled<ContactQueueOutcome> | null;
}

// ---------------------------------------------------------------------------
// Errors (GET /api/errors/queue)
// ---------------------------------------------------------------------------

export const ERROR_QUEUE_OUTCOMES = ['resolved', 'ignored'] as const;
export type ErrorQueueOutcome = (typeof ERROR_QUEUE_OUTCOMES)[number];
export const ERROR_QUEUE_SORTS = [...ADMIN_QUEUE_BASE_SORTS, 'count', 'users'] as const;
export type ErrorQueueSort = (typeof ERROR_QUEUE_SORTS)[number];

export interface ErrorQueueItem {
  id: string;
  app: string;
  environment: string;
  kind: string;
  name: string | null;
  message: string;
  route: string | null;
  status: 'new' | 'acknowledged' | 'resolved' | 'ignored';
  occurrences: number;
  users: number;
  /** Open needs-action items in the group */
  openActions: number;
  firstSeen: string;
  lastSeen: string;
  assignee: AdminQueuePerson | null;
  link: AdminQueueLink;
  handled: AdminQueueHandled<ErrorQueueOutcome> | null;
}

// ---------------------------------------------------------------------------
// Labels (en + ar) for the tabs and outcomes
// ---------------------------------------------------------------------------

export const ADMIN_QUEUE_LABELS: Record<'en' | 'ar', Record<AdminQueueTab | AiQueueOutcome | ContactQueueOutcome | ErrorQueueOutcome | 'unknownPerson', string>> = {
  en: {
    action: 'Action needed',
    history: 'History',
    agree: 'Agreed with AI',
    disagree: 'Disagreed with AI',
    hide: 'Hidden',
    restore: 'Restored',
    replied: 'Replied',
    closed: 'Closed',
    spam: 'Spam',
    resolved: 'Resolved',
    ignored: 'Ignored',
    unknownPerson: 'Unknown',
  },
  ar: {
    action: 'بحاجة إلى إجراء',
    history: 'السجل',
    agree: 'موافقة على الذكاء الاصطناعي',
    disagree: 'عدم موافقة على الذكاء الاصطناعي',
    hide: 'مخفي',
    restore: 'مُستعاد',
    replied: 'تم الرد',
    closed: 'مغلق',
    spam: 'رسالة مزعجة',
    resolved: 'تم الحل',
    ignored: 'متجاهَل',
    unknownPerson: 'غير معروف',
  },
};
