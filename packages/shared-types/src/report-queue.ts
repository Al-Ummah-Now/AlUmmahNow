/**
 * Reports queue for the videos admin (admin-api /api/moderation/queue/*).
 *
 * Owner decision (2026-11-11): "it should be action needed, history should be
 * a tab away, with good search on both".
 *
 *   GET  /api/moderation/queue                                     Action needed: open reports grouped per reported item
 *   GET  /api/moderation/queue/history                             History: closed reports, one row per report
 *   GET  /api/moderation/queue/items/:entityType/:entityId         One item: its group, open reports and history
 *   POST /api/moderation/queue/items/:entityType/:entityId/action  One decision for every open report of the item
 *   GET  /api/suggest/report?q=…                                   Live autocomplete; each suggestion is an item group
 *
 * Every response is `{ success: true, result: … }`, like the other admin lists.
 * Pages are 1-based `page` + `pageSize` (max 100), with `total`, like the
 * content lists (AdminPage). Both list responses carry `counts` for the tab
 * badges, computed with the shared filters (q, entityType, reason, from, to).
 *
 * Search (`q`) matches, case-insensitively, the item title or text excerpt,
 * channel name, uploader (owner) name, reporter name, reason and report text;
 * an exact item, channel, owner or reporter id matches too. History also
 * matches the moderator's name and notes. Names and titles are copies kept on
 * each report row (captured after the report is filed and refreshed while it
 * is open), so the search runs in D1 and a removed item keeps its title.
 */
import type { ModerationAction, ReportableEntityType, ReportReason, ReportStatus } from './moderation';
import type { ModerationDecision, ModerationReviewStatus } from './ai-moderation';

export const REPORT_ENTITY_TYPES: readonly ReportableEntityType[] = ['video', 'comment', 'channel', 'livestream', 'playlist', 'post'];
export const REPORT_REASONS: readonly ReportReason[] = ['inappropriate', 'spam', 'harassment', 'copyright', 'misinformation', 'other'];

/**
 * Report outcomes. The first four are the values the report page has always
 * sent (and its E2E uses):
 *   warning   — flag the content with a warning, keep it visible
 *   removed   — hide the content (restorable)
 *   banned    — ban the content's owner (the same ban as Users → Ban: needs the
 *               users:manage permission, audited) and hide the content
 *   dismissed — no action
 * and `deleted` — remove the content permanently (what `banned` used to do).
 */
export const REPORT_OUTCOMES: readonly ModerationAction[] = ['warning', 'removed', 'banned', 'deleted', 'dismissed'];

/** Outcomes that need a content permission on top of the moderator role. */
export const REPORT_OUTCOME_PERMISSION: Readonly<Partial<Record<ModerationAction, 'users:manage'>>> = { banned: 'users:manage' };

export const REPORT_QUEUE_SORTS = ['oldest', 'newest', 'most_reports'] as const;
/** oldest: first reported first (default; nothing waits forever); newest: last reported first; most_reports: most open reports first. */
export type ReportQueueSort = (typeof REPORT_QUEUE_SORTS)[number];

export const REPORT_HISTORY_SORTS = ['newest', 'oldest'] as const;
/** By the time the report was closed. Default newest. */
export type ReportHistorySort = (typeof REPORT_HISTORY_SORTS)[number];

export const REPORT_QUEUE_DEFAULT_PAGE_SIZE = 20;
export const REPORT_QUEUE_MAX_PAGE_SIZE = 100;
/** Report texts shown per group (newest first). */
export const REPORT_GROUP_LATEST = 3;

/** Filters both tabs share. Dates are ISO dates or timestamps, compared with the report's created_at. */
export interface ReportQueueFilters {
  q?: string;
  entityType?: ReportableEntityType;
  reason?: ReportReason;
  /** Reported on or after (inclusive). */
  from?: string;
  /** Reported before (exclusive; a bare date means the end of that day). */
  to?: string;
  page?: number;
  pageSize?: number;
}

/** GET /api/moderation/queue */
export interface ReportQueueQuery extends ReportQueueFilters {
  sort?: ReportQueueSort;
}

/** GET /api/moderation/queue/history */
export interface ReportHistoryQuery extends ReportQueueFilters {
  /** The outcome taken. */
  action?: ModerationAction;
  /** The moderator who closed the report (a user id, picked with /api/suggest/user). */
  moderatorId?: string;
  sort?: ReportHistorySort;
}

/** Tab badges: how many rows each tab has under the shared filters. */
export interface ReportQueueCounts {
  /** Reported items with open reports. */
  actionNeeded: number;
  /** Open reports (across those items). */
  openReports: number;
  /** Closed reports. */
  history: number;
}

export interface ReportPerson {
  id: string;
  /** Display name; null when the user could not be found (deleted). */
  name: string | null;
}

/** The reported item as the moderator needs to judge it, without further calls. */
export interface ReportedItemSummary {
  type: ReportableEntityType;
  id: string;
  /** Title, or a text excerpt for comments and posts; null when unknown. */
  title: string | null;
  /** Video id of a reported comment (for its link). */
  parentId: string | null;
  channel: { id: string; name: string | null } | null;
  owner: (ReportPerson & { isBanned: boolean | null }) | null;
  /**
   * True: live data from api-videos. False: api-videos no longer has the item
   * (title etc. are the copies kept on the reports). Null: api-videos could not
   * be reached (copies shown).
   */
  found: boolean | null;
  isHidden: boolean | null;
  isDeleted: boolean | null;
}

/** The latest AI moderation signal for the item (moderation_signals), if any. */
export interface ReportAiSummary {
  signalId: string;
  decision: ModerationDecision;
  topCategory: string | null;
  topScore: number | null;
  reviewStatus: ModerationReviewStatus;
  createdAt: string;
}

export interface ReportExcerpt {
  reportId: string;
  reason: ReportReason;
  description: string | null;
  reporter: ReportPerson;
  createdAt: string;
}

/** One reported item with its open reports (Action needed row). */
export interface ReportGroup {
  /** `${type}:${id}`: the row key and what a `report` suggestion resolves to. */
  key: string;
  item: ReportedItemSummary;
  reportCount: number;
  /** reason → open reports with that reason. */
  reasons: Partial<Record<ReportReason, number>>;
  firstReportedAt: string;
  lastReportedAt: string;
  /** The newest REPORT_GROUP_LATEST reports. */
  latest: ReportExcerpt[];
  ai: ReportAiSummary | null;
}

/** One closed report (History row). History is per report: each report carries its own decision. */
export interface ReportHistoryRow {
  reportId: string;
  key: string;
  item: ReportedItemSummary;
  reason: ReportReason;
  description: string | null;
  reporter: ReportPerson;
  status: Extract<ReportStatus, 'resolved' | 'dismissed'>;
  action: ModerationAction | null;
  notes: string | null;
  moderator: ReportPerson | null;
  /** The user the `banned` outcome banned (the item's owner at the time). */
  bannedUserId: string | null;
  reportedAt: string;
  closedAt: string | null;
}

export interface ReportQueuePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  counts: ReportQueueCounts;
}

/** GET /api/moderation/queue → result */
export type ReportQueueResult = ReportQueuePage<ReportGroup>;
/** GET /api/moderation/queue/history → result */
export type ReportHistoryResult = ReportQueuePage<ReportHistoryRow>;

/** GET /api/moderation/queue/items/:entityType/:entityId → result */
export interface ReportItemResult {
  /** Null when the item has no open reports. */
  group: ReportGroup | null;
  item: ReportedItemSummary;
  /** Every open report (oldest first, up to 200). */
  open: ReportExcerpt[];
  /** Its closed reports, newest first (up to 50). */
  history: ReportHistoryRow[];
}

/** POST /api/moderation/queue/items/:entityType/:entityId/action (and the per-report action) body. */
export interface ReportDecisionInput {
  action: ModerationAction;
  notes?: string;
}

/** What the decision did to the content and its owner. */
export interface ReportDecisionEffect {
  performed: boolean;
  action: ModerationAction;
  notes: string;
  /** `banned`: the owner who was banned (null when the item or its owner was not found). */
  bannedUserId?: string | null;
}

/** POST …/items/:entityType/:entityId/action → result */
export interface ReportDecisionResult {
  /** The reports this decision closed. */
  closed: string[];
  contentAction: ReportDecisionEffect;
}

// ---------------------------------------------------------------------------
// api-videos batch lookup (POST /internal/admin/lookup), used by admin-api to
// fill the item summaries of a page in one call.
// ---------------------------------------------------------------------------

export const ADMIN_LOOKUP_MAX_ITEMS = 200;
export const ADMIN_LOOKUP_MAX_USERS = 300;

export interface AdminLookupRequest {
  items: { type: ReportableEntityType; id: string }[];
  /** Users to name (reporters, moderators). The owners of found items are added automatically. */
  users: string[];
}

export interface AdminLookupItem {
  type: ReportableEntityType;
  id: string;
  found: boolean;
  title: string | null;
  parentId: string | null;
  channelId: string | null;
  channelName: string | null;
  ownerId: string | null;
  isHidden: boolean | null;
  isDeleted: boolean | null;
}

export interface AdminLookupUser {
  id: string;
  found: boolean;
  displayName: string | null;
  userName: string | null;
  isBanned: boolean;
}

export interface AdminLookupResult {
  items: AdminLookupItem[];
  users: AdminLookupUser[];
}
