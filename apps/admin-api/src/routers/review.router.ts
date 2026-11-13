/**
 * /api/review/* — the video review queue for people, web (admin-web) and native (the native admin
 * app) alike: JSON, cursor paging, the same auth (docs/specs/VIDEO-REVIEW.md §6).
 *
 *   GET  /queue?tab=action_needed|checking|history|shadow&cursor=&escalated=1   the queue
 *   GET  /stats                                     queue size, live queue time, today's cost, shadow report
 *   GET  /alerts            POST /alerts {on}        my instant alerts (in-app + push, VR6)
 *   GET  /settings          PUT  /settings          review settings (admins; audited)
 *   PUT  /channels/:channelId/trust {trusted}        post-hoc review for a channel (admins; audited)
 *   GET  /:id                                        one review: findings, history, subject
 *   GET  /:id/media?key=review/...                   a frame or manifest of the review (streamed)
 *   POST /:id/reveal {target}                        audited reveal of a blurred NSFW item
 *   POST /:id/claim                                  assign to me
 *   POST /:id/decision {decision, reasonCode?, note?} approve | reject | escalate | undo
 *
 * Who: content reviewers, senior reviewers, moderators and admins (isReviewer). Escalations and
 * appeals of escalated items are senior only (VR7). Settings and trust: admins.
 */
import { Hono, type Context } from 'hono';
import { isAdmin, isReviewer, readVideoReviewSettings, writeVideoReviewSettings, effectiveReviewMode, type ReviewSettingsBucket } from '@al-ummah/shared-types';
import { alertsOn, claimReview, decideReview, getReview, listQueue, recordReveal, reviewMedia, reviewStats, ReviewError, setAlerts, type QueueQuery, type Reviewer, type ReviewEnv } from '../lib/review/queue';
import { logger } from '../lib/logger';
import type { AuthContext } from '../base/types';

type Env = { Bindings: ReviewEnv & { channels?: R2Bucket; VIDEO_REVIEW_ALLOWED?: string }; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

function reviewerOf(c: C): Reviewer {
  const auth = c.get('auth');
  if (!auth?.userId || !isReviewer(auth.roles ?? [])) throw new ReviewError(403, 'reviewer_only', 'A reviewer role is required');
  return { id: auth.userId, roles: auth.roles ?? [] };
}

function adminOf(c: C): Reviewer {
  const reviewer = reviewerOf(c);
  if (!isAdmin(reviewer.roles)) throw new ReviewError(403, 'admin_only', 'Only admins change review settings');
  return reviewer;
}

app.onError((error, c) => {
  if (error instanceof ReviewError) return c.json({ success: false, code: error.code, error: error.message }, error.status);
  logger.error('[Review] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const TABS = ['action_needed', 'checking', 'history', 'shadow'] as const;

app.get('/queue', async (c) => {
  const reviewer = reviewerOf(c);
  const tab = (c.req.query('tab') ?? 'action_needed') as QueueQuery['tab'];
  if (!(TABS as readonly string[]).includes(tab)) throw new ReviewError(400, 'invalid_request', `tab must be one of ${TABS.join(', ')}`);
  const result = await listQueue(c.env.REPORTS_DB, reviewer, { tab, cursor: c.req.query('cursor'), limit: Number(c.req.query('limit')) || undefined, escalatedOnly: c.req.query('escalated') === '1' });
  return c.json({ success: true, result });
});

app.get('/stats', async (c) => {
  reviewerOf(c);
  return c.json({ success: true, result: await reviewStats(c.env.REPORTS_DB) });
});

app.get('/alerts', async (c) => {
  const reviewer = reviewerOf(c);
  return c.json({ success: true, result: { alerts: await alertsOn(c.env.REPORTS_DB, reviewer) } });
});

app.post('/alerts', async (c) => {
  const reviewer = reviewerOf(c);
  const body = (await c.req.json().catch(() => ({}))) as { on?: unknown };
  return c.json({ success: true, result: await setAlerts(c.env.REPORTS_DB, reviewer, body.on !== false) });
});

app.get('/settings', async (c) => {
  reviewerOf(c);
  const settings = await readVideoReviewSettings(c.env.global_settings as ReviewSettingsBucket | undefined, true);
  // QA and stage: the stored mode is shown, but nothing runs there (VIDEO_REVIEW_ALLOWED)
  return c.json({ success: true, result: { settings, effectiveMode: effectiveReviewMode(settings, c.env.VIDEO_REVIEW_ALLOWED), allowedHere: c.env.VIDEO_REVIEW_ALLOWED === 'true' } });
});

app.put('/settings', async (c) => {
  const admin = adminOf(c);
  if (!c.env.global_settings) throw new ReviewError(502, 'not_configured', 'global_settings is not bound');
  const patch = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!patch || typeof patch !== 'object') throw new ReviewError(400, 'invalid_request', 'A JSON object is required');
  const before = await readVideoReviewSettings(c.env.global_settings as ReviewSettingsBucket, true);
  const settings = await writeVideoReviewSettings(c.env.global_settings as ReviewSettingsBucket, patch as never, admin.id);
  await c.env.REPORTS_DB.prepare(`INSERT INTO moderation_actions (id, signal_id, subject_type, subject_id, action, actor_type, actor_id, reason, details_json, created_at) VALUES (?, NULL, 'video_review', 'settings', 'config_change', 'user', ?, NULL, ?, ?)`)
    .bind(crypto.randomUUID(), admin.id, JSON.stringify({ before: { mode: before.mode, thresholds: before.thresholds }, patch }), new Date().toISOString())
    .run();
  logger.info('[Review] Settings changed', { actorId: admin.id, mode: settings.mode });
  return c.json({ success: true, result: { settings, effectiveMode: effectiveReviewMode(settings, c.env.VIDEO_REVIEW_ALLOWED) } });
});

app.put('/channels/:channelId/trust', async (c) => {
  const admin = adminOf(c);
  const channelId = c.req.param('channelId');
  const body = (await c.req.json().catch(() => ({}))) as { trusted?: unknown };
  if (typeof body.trusted !== 'boolean') throw new ReviewError(400, 'invalid_request', 'trusted must be true or false');
  const bucket = c.env.channels;
  if (!bucket) throw new ReviewError(502, 'not_configured', 'channels is not bound');
  for (let attempt = 0; attempt < 5; attempt++) {
    const object = await bucket.get(channelId);
    if (!object) throw new ReviewError(404, 'not_found', 'Channel not found');
    const channel = (await object.json()) as Record<string, unknown>;
    if (body.trusted) channel.reviewTrusted = true;
    else delete channel.reviewTrusted;
    if (await bucket.put(channelId, JSON.stringify(channel), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: object.etag } })) {
      await c.env.REPORTS_DB.prepare(`INSERT INTO moderation_actions (id, signal_id, subject_type, subject_id, action, actor_type, actor_id, reason, details_json, created_at) VALUES (?, NULL, 'channel', ?, ?, 'user', ?, NULL, NULL, ?)`)
        .bind(crypto.randomUUID(), channelId, body.trusted ? 'review_trust' : 'review_untrust', admin.id, new Date().toISOString())
        .run();
      return c.json({ success: true, result: { channelId, trusted: body.trusted } });
    }
  }
  throw new ReviewError(409, 'busy', 'The channel kept changing; try again');
});

app.get('/:id', async (c) => {
  const reviewer = reviewerOf(c);
  return c.json({ success: true, result: await getReview(c.env, reviewer, c.req.param('id')) });
});

app.get('/:id/media', async (c) => {
  const reviewer = reviewerOf(c);
  const object = await reviewMedia(c.env, reviewer, c.req.param('id'), c.req.query('key') ?? '');
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      // Unpublished, possibly NSFW media: never cached anywhere
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});

app.post('/:id/reveal', async (c) => {
  const reviewer = reviewerOf(c);
  const body = (await c.req.json().catch(() => ({}))) as { target?: unknown };
  return c.json({ success: true, result: await recordReveal(c.env.REPORTS_DB, reviewer, c.req.param('id'), String(body.target ?? 'item')) });
});

app.post('/:id/claim', async (c) => {
  const reviewer = reviewerOf(c);
  return c.json({ success: true, result: await claimReview(c.env.REPORTS_DB, reviewer, c.req.param('id')) });
});

app.post('/:id/decision', async (c) => {
  const reviewer = reviewerOf(c);
  const body = (await c.req.json().catch(() => null)) as { decision?: unknown; reasonCode?: unknown; note?: unknown } | null;
  const decision = body?.decision;
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'escalate' && decision !== 'undo') throw new ReviewError(400, 'invalid_request', 'decision must be approve, reject, escalate or undo');
  const result = await decideReview(c.env, reviewer, c.req.param('id'), { decision, reasonCode: typeof body?.reasonCode === 'string' ? body.reasonCode : undefined, note: typeof body?.note === 'string' ? body.note : undefined });
  logger.info('[Review] Decision', { reviewId: c.req.param('id'), decision, reviewerId: reviewer.id });
  return c.json({ success: true, result });
});

export default app;
