/**
 * AI moderation review (Epic 28, docs/specs/EPIC-28-PLAN.md §5).
 *
 * Plain functions over D1 + R2 so they are unit tested without the Workers runtime.
 * Rules: nothing is ever deleted; hide sets a reversible `held` status on a video comment
 * (marked `heldBy: 'moderation'` so restore only undoes moderation holds); every action is
 * written to moderation_actions with the reviewer's id.
 */
import { updateJson } from './r2Cas';
import {
  AI_HIDEABLE_CATEGORIES,
  LLAMA_GUARD_CATEGORIES,
  MODERATION_EXTENSION_CATEGORIES,
  type AiModerationConfig,
  type ModerationCategory,
  type ModerationCategoryPolicy,
  type ModerationSignal,
} from '@al-ummah/shared-types';

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(col?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown>;
}

export interface R2Like {
  get(key: string): Promise<{ text(): Promise<string>; etag: string } | null>;
  put(key: string, value: string, options?: unknown): Promise<unknown>;
}

export const ALL_CATEGORIES: readonly string[] = [...Object.keys(LLAMA_GUARD_CATEGORIES), ...MODERATION_EXTENSION_CATEGORIES];

// ---------- signals ----------

export interface SignalFilters {
  review_status?: string | undefined;
  decision?: string | undefined;
  surface?: string | undefined;
  language?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

type SignalRow = Omit<ModerationSignal, 'categories'> & { categories_json: string };

function toSignal(row: SignalRow): ModerationSignal {
  const { categories_json, ...rest } = row;
  let categories: Record<string, number> = {};
  try {
    categories = JSON.parse(categories_json || '{}');
  } catch {
    categories = {};
  }
  return { ...rest, categories };
}

export async function listSignals(db: D1Like, filters: SignalFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: string | undefined) => {
    if (value) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  };
  add('review_status', filters.review_status);
  add('decision', filters.decision);
  add('surface', filters.surface);
  add('language', filters.language);
  add('top_category', filters.category);
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const rows = await db
    .prepare(`SELECT * FROM moderation_signals${clause} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<SignalRow>();
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM moderation_signals${clause}`).bind(...params).first<{ count: number }>();
  return { signals: (rows.results ?? []).map(toSignal), total: Number(count?.count ?? 0), limit, offset };
}

export async function getSignal(db: D1Like, id: string) {
  const row = await db.prepare('SELECT * FROM moderation_signals WHERE id = ?').bind(id).first<SignalRow>();
  if (!row) return null;
  const actions = await db
    .prepare('SELECT * FROM moderation_actions WHERE subject_type = ? AND subject_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(row.subject_type, row.subject_id)
    .all();
  return { signal: toSignal(row), actions: actions.results ?? [] };
}

export interface ActionInput {
  signalId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  action: string;
  actorId: string;
  reason?: string | null | undefined;
  details?: unknown;
}

function actionStatement(db: D1Like, input: ActionInput, now: string) {
  return db
    .prepare(
      `INSERT INTO moderation_actions (id, signal_id, subject_type, subject_id, action, actor_type, actor_id, reason, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'user', ?, ?, ?, ?)`
    )
    .bind(
      crypto.randomUUID(),
      input.signalId ?? null,
      input.subjectType ?? null,
      input.subjectId ?? null,
      input.action,
      input.actorId,
      input.reason ?? null,
      input.details === undefined ? null : JSON.stringify(input.details),
      now
    );
}

/** The reviewer: an id, or the id and email (the email names them on the History tab when no profile does). */
export type Reviewer = string | { id: string; email?: string | null | undefined };
const reviewerOf = (r: Reviewer) => (typeof r === 'string' ? { id: r, email: null } : { id: r.id, email: r.email ?? null });

/** Records the reviewer's latest decision on the signal: it moves to the History tab (docs/admin/QUEUES.md). */
function handledStatement(db: D1Like, signalId: string, action: 'agree' | 'disagree' | 'hide' | 'restore', reviewer: Reviewer, iso: string) {
  const r = reviewerOf(reviewer);
  return db
    .prepare('UPDATE moderation_signals SET handled_action = ?, handled_by_id = ?, handled_by_email = ?, handled_at = ? WHERE id = ?')
    .bind(action, r.id, r.email, iso, signalId);
}

/** Feedback label (spec §6): the reviewer agrees or disagrees with the AI. */
export async function reviewSignal(db: D1Like, id: string, verdict: 'agree' | 'disagree', reviewer: Reviewer, note?: string, now = new Date()) {
  const reviewerId = reviewerOf(reviewer).id;
  const row = await db.prepare('SELECT id, subject_type, subject_id FROM moderation_signals WHERE id = ?').bind(id).first<{ id: string; subject_type: string; subject_id: string }>();
  if (!row) return null;
  const iso = now.toISOString();
  await db.batch([
    db
      .prepare('UPDATE moderation_signals SET review_status = ?, reviewer_id = ?, reviewer_decision = ?, reviewed_at = ? WHERE id = ?')
      .bind(verdict === 'agree' ? 'agreed' : 'disagreed', reviewerId, verdict, iso, id),
    actionStatement(db, { signalId: id, subjectType: row.subject_type, subjectId: row.subject_id, action: verdict, actorId: reviewerId, reason: note }, iso),
    handledStatement(db, id, verdict, reviewer, iso),
  ]);
  return { id, review_status: verdict === 'agree' ? 'agreed' : 'disagreed' };
}

// ---------- subject content (live from R2, never from D1) ----------

interface StoredComment {
  id: string;
  text?: string;
  userId?: string;
  status?: string;
  heldBy?: string;
  replies?: StoredComment[];
}

function findComment(list: StoredComment[], id: string): StoredComment | null {
  for (const comment of list) {
    if (comment.id === id) return comment;
    const reply = (comment.replies ?? []).find((r) => r.id === id);
    if (reply) return reply;
  }
  return null;
}

async function readJson<T>(bucket: R2Like | undefined, key: string): Promise<T | null> {
  if (!bucket) return null;
  const object = await bucket.get(key);
  if (!object) return null;
  return JSON.parse(await object.text()) as T;
}

export interface SubjectContent {
  available: boolean;
  text: string | null;
  hidden: boolean;
  hiddenByModeration: boolean;
  /** Whether hide/restore is supported for this subject type (video comments in Phase A). */
  canHide: boolean;
}

export async function getSubjectContent(
  buckets: { videos: R2Like; community_posts?: R2Like | undefined },
  signal: Pick<ModerationSignal, 'subject_type' | 'subject_id' | 'parent_id' | 'channel_id'>
): Promise<SubjectContent> {
  const none: SubjectContent = { available: false, text: null, hidden: false, hiddenByModeration: false, canHide: false };
  if (signal.subject_type === 'comment' && signal.parent_id) {
    const video = await readJson<{ comments?: StoredComment[] }>(buckets.videos, signal.parent_id);
    const comment = video ? findComment(video.comments ?? [], signal.subject_id) : null;
    if (!comment) return { ...none, canHide: true };
    return { available: true, text: comment.text ?? null, hidden: comment.status === 'held', hiddenByModeration: comment.heldBy === 'moderation', canHide: true };
  }
  if (signal.subject_type === 'video') {
    const video = await readJson<{ title?: string; description?: string; tags?: string[] }>(buckets.videos, signal.subject_id);
    if (!video) return none;
    return { ...none, available: true, text: [video.title, video.description, (video.tags ?? []).join(' ')].filter(Boolean).join('\n') };
  }
  if (signal.subject_type === 'post' && signal.channel_id) {
    const post = await readJson<{ content?: string }>(buckets.community_posts, `posts/${signal.channel_id}/${signal.subject_id}.json`);
    return post ? { ...none, available: true, text: post.content ?? null } : none;
  }
  if (signal.subject_type === 'post_comment' && signal.parent_id) {
    const comment = await readJson<{ content?: string }>(buckets.community_posts, `comments/${signal.parent_id}/top-level/${signal.subject_id}.json`);
    return comment ? { ...none, available: true, text: comment.content ?? null } : none;
  }
  return none;
}

/**
 * Reviewer hide/restore of a video comment. Reversible: hide sets status 'held' with
 * heldBy 'moderation'; restore clears it only when moderation set it (a creator's own
 * "hold for approval" is left alone).
 */
export async function setCommentHidden(
  db: D1Like,
  videos: R2Like,
  signalId: string,
  hidden: boolean,
  reviewer: Reviewer,
  reason?: string,
  now = new Date()
): Promise<{ ok: true; changed: boolean } | { ok: false; error: 'not_found' | 'unsupported' | 'subject_missing' }> {
  const row = await db
    .prepare('SELECT id, subject_type, subject_id, parent_id FROM moderation_signals WHERE id = ?')
    .bind(signalId)
    .first<{ id: string; subject_type: string; subject_id: string; parent_id: string | null }>();
  if (!row) return { ok: false, error: 'not_found' };
  if (row.subject_type !== 'comment' || !row.parent_id) return { ok: false, error: 'unsupported' };

  // Conditional write on the current video (SCALABILITY-AUDIT AA-2): a comment
  // posted or an edit made meanwhile is kept, and cannot undo the hide.
  let missing = false;
  let changed = false;
  const result = await updateJson<{ comments?: StoredComment[] } & Record<string, unknown>>(videos, row.parent_id, (video) => {
    changed = false;
    const comment = video ? findComment(video.comments ?? [], row.subject_id) : null;
    missing = !video || !comment;
    if (!video || !comment) return undefined;
    if (hidden && comment.status !== 'held') {
      comment.status = 'held';
      comment.heldBy = 'moderation';
      changed = true;
    } else if (!hidden && comment.status === 'held' && comment.heldBy === 'moderation') {
      delete comment.status;
      delete comment.heldBy;
      changed = true;
    }
    return changed ? video : undefined;
  });
  if (missing || !result) return { ok: false, error: 'subject_missing' };

  const iso = now.toISOString();
  await db.batch([
    actionStatement(
      db,
      { signalId, subjectType: row.subject_type, subjectId: row.subject_id, action: hidden ? 'hide' : 'restore', actorId: reviewerOf(reviewer).id, reason, details: { changed } },
      iso
    ),
    handledStatement(db, signalId, hidden ? 'hide' : 'restore', reviewer, iso),
  ]);
  return { ok: true, changed };
}

// ---------- config ----------

const DEFAULT_CAP = 10_000;

export async function readConfig(db: D1Like, envCap?: string): Promise<AiModerationConfig & { updatedAt: string | null; updatedBy: string | null }> {
  const rows = await db.prepare('SELECT key, value, updated_by, updated_at FROM moderation_config').all<{ key: string; value: string; updated_by: string | null; updated_at: string }>();
  const map = new Map((rows.results ?? []).map((r) => [r.key, r]));
  const parse = <T>(key: string): T | undefined => {
    const r = map.get(key);
    if (!r) return undefined;
    try {
      return JSON.parse(r.value) as T;
    } catch {
      return undefined;
    }
  };
  const latest = [...map.values()].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
  const cap = parse<number>('daily_neuron_cap');
  const envCapNum = Number(envCap);
  return {
    enabled: parse<boolean>('enabled') === true,
    dailyNeuronCap: typeof cap === 'number' ? cap : Number.isFinite(envCapNum) && envCap ? envCapNum : DEFAULT_CAP,
    extensionsEnabled: parse<boolean>('extensions_enabled') === true,
    policies: parse<AiModerationConfig['policies']>('policies') ?? {},
    updatedAt: latest?.updated_at ?? null,
    updatedBy: latest?.updated_by ?? null,
  };
}

export interface ConfigPatch {
  enabled?: boolean | undefined;
  dailyNeuronCap?: number | undefined;
  extensionsEnabled?: boolean | undefined;
  policies?: Record<string, Partial<ModerationCategoryPolicy>> | undefined;
}

/** Validates a config patch. Refuses `hide` outside spam/charity_scam (spec M2). */
export function validateConfigPatch(patch: ConfigPatch): string | null {
  if (patch.dailyNeuronCap !== undefined && (!Number.isFinite(patch.dailyNeuronCap) || patch.dailyNeuronCap < 0 || patch.dailyNeuronCap > 10_000_000)) {
    return 'dailyNeuronCap must be between 0 and 10,000,000';
  }
  for (const [category, policy] of Object.entries(patch.policies ?? {})) {
    if (!ALL_CATEGORIES.includes(category)) return `Unknown category: ${category}`;
    if (policy.threshold !== undefined && (typeof policy.threshold !== 'number' || policy.threshold < 0 || policy.threshold > 1)) return `${category}: threshold must be between 0 and 1`;
    if (policy.mode !== undefined && policy.mode !== 'shadow' && policy.mode !== 'enforce') return `${category}: mode must be shadow or enforce`;
    if (policy.action !== undefined && !['none', 'flag', 'hide'].includes(policy.action)) return `${category}: action must be none, flag or hide`;
    if (policy.action === 'hide' && !AI_HIDEABLE_CATEGORIES.includes(category as ModerationCategory)) return `${category}: only spam and charity_scam may be hidden automatically`;
    if (category === 'religious_authenticity' && policy.action === 'hide') return 'religious_authenticity is flag-only';
  }
  return null;
}

export async function writeConfig(db: D1Like, patch: ConfigPatch, actorId: string, now = new Date()) {
  const iso = now.toISOString();
  const statements: D1StatementLike[] = [];
  const upsert = (key: string, value: unknown) =>
    statements.push(
      db
        .prepare('INSERT INTO moderation_config (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
        .bind(key, JSON.stringify(value), actorId, iso)
    );
  if (patch.enabled !== undefined) upsert('enabled', patch.enabled);
  if (patch.dailyNeuronCap !== undefined) upsert('daily_neuron_cap', patch.dailyNeuronCap);
  if (patch.extensionsEnabled !== undefined) upsert('extensions_enabled', patch.extensionsEnabled);
  if (patch.policies !== undefined) {
    const current = await readConfig(db);
    const merged: Record<string, Partial<ModerationCategoryPolicy>> = { ...(current.policies as Record<string, Partial<ModerationCategoryPolicy>>) };
    for (const [category, policy] of Object.entries(patch.policies)) merged[category] = { ...merged[category], ...policy };
    upsert('policies', merged);
  }
  statements.push(actionStatement(db, { action: 'config_change', actorId, details: patch }, iso));
  await db.batch(statements);
}

// ---------- usage ----------

export async function readUsage(db: D1Like, days: number, now = new Date()) {
  const n = Math.min(Math.max(Math.floor(days) || 30, 1), 90);
  const since = new Date(now.getTime() - (n - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .prepare('SELECT day, model, calls, input_tokens, output_tokens, neurons, usd FROM ai_usage_daily WHERE feature = ? AND day >= ? ORDER BY day DESC, model')
    .bind('moderation', since)
    .all();
  const today = now.toISOString().slice(0, 10);
  const todayRow = await db
    .prepare('SELECT COALESCE(SUM(neurons), 0) AS neurons, COALESCE(SUM(usd), 0) AS usd FROM ai_usage_daily WHERE feature = ? AND day = ?')
    .bind('moderation', today)
    .first<{ neurons: number; usd: number }>();
  return { days: n, since, rows: rows.results ?? [], today: { day: today, neurons: Number(todayRow?.neurons ?? 0), usd: Number(todayRow?.usd ?? 0) } };
}
