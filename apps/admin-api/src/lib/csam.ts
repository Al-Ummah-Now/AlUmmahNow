/**
 * CSAM cases (docs/specs/CSAM-RESPONSE.md): intake, mapping, the account freeze, the report, the
 * legal hold, retention and the access log. Super admins only (routers/csam.router.ts checks).
 *
 * api-videos owns the takedown and the evidence (/internal/csam/*); this module owns the case:
 * who did what, when it was reported, and when its evidence may go.
 */
import {
  CSAM_RETENTION_MIN_DAYS,
  csamRetainUntil,
  csamUrlKey,
  extractCsamUrls,
  newErrorRef,
  scrubEvent,
  validCsamRetentionDays,
  type AdminChannelDetail,
  type AdminUserDetail,
  type AdminVideoDetail,
  type CsamAccessAction,
  type CsamAccessLogEntry,
  type CsamAuthRequestState,
  type CsamCaseDetail,
  type CsamCaseStatus,
  type CsamCaseSummary,
  type CsamEvidenceManifest,
  type CsamFreezeState,
  type CsamReportFacts,
  type CsamResolution,
  type CsamSettings,
  type CsamTakedownJob,
} from '@al-ummah/shared-types';
import type { AdminBindings } from '../base/types';
import { callVideos, fetchVideosRaw, VideosError, type VideosClientEnv } from './content/videosClient';
import { buildEvidence, getRow, insertSending, type MirrorRow } from './authModeration';
import { enqueueSend, type QueueEnv } from './authModerationQueue';
import { logger } from './logger';

export type CsamEnv = AdminBindings & VideosClientEnv & Omit<QueueEnv, 'REPORTS_DB'>;
type Db = AdminBindings['REPORTS_DB'];

export class CsamError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 503, readonly code: string, message?: string) {
    super(message ?? code);
  }
}

/** Actors recorded for the platform's own actions. */
export const WEBHOOK_ACTOR = 'cloudflare-webhook';
export const RETENTION_ACTOR = 'retention-sweep';
const MAX_URLS = 200;
const REPORT_ID = /^[A-Za-z0-9-]{3,64}$/;
export const CASE_ID = /^[A-Za-z0-9-]{8,64}$/;

interface CaseRow {
  id: string;
  matched_url: string;
  url_key: string;
  source: 'paste' | 'webhook';
  status: CsamCaseStatus;
  item_kind: string | null;
  resolution: string | null;
  uploader_id: string | null;
  job_id: string | null;
  freeze: string | null;
  facts: string | null;
  detected_at: string;
  created_by: string;
  report_id: string | null;
  reported_at: string | null;
  reported_by: string | null;
  legal_hold: number;
  legal_hold_reason: string | null;
  evidence_deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

const json = <T>(text: string | null): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};
const nowIso = () => new Date().toISOString();
const csam = { base: '/internal/csam' as const };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function setting(db: Db, key: string): Promise<string | null> {
  return (await db.prepare('SELECT value FROM csam_settings WHERE key = ?').bind(key).first<{ value: string }>())?.value ?? null;
}

async function putSetting(db: Db, key: string, value: string, actorId: string): Promise<void> {
  await db
    .prepare('INSERT INTO csam_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(key, value, actorId, nowIso())
    .run();
}

export async function retentionDays(db: Db): Promise<number> {
  const days = Number(await setting(db, 'retention_days'));
  return validCsamRetentionDays(days) ? days : CSAM_RETENTION_MIN_DAYS;
}

export function webhookUrlFor(env: Pick<AdminBindings, 'ENVIRONMENT'>): string {
  const environment = (env.ENVIRONMENT ?? 'production').toLowerCase();
  const host = environment === 'production' ? 'admin.api.alummahnow.net' : `admin.${environment === 'staging' ? 'stage' : environment}.api.alummahnow.net`;
  return `https://${host}/webhooks/cloudflare/notifications`;
}

export async function readSettings(env: CsamEnv): Promise<CsamSettings> {
  return { retentionDays: await retentionDays(env.REPORTS_DB), webhookConfigured: !!(await setting(env.REPORTS_DB, 'webhook_secret_sha256')), webhookUrl: webhookUrlFor(env) };
}

export async function setRetentionDays(env: CsamEnv, days: unknown, actorId: string): Promise<CsamSettings> {
  if (!validCsamRetentionDays(days)) throw new CsamError(400, 'invalid_retention', `Retention is a whole number of days from ${CSAM_RETENTION_MIN_DAYS}`);
  const before = await retentionDays(env.REPORTS_DB);
  await putSetting(env.REPORTS_DB, 'retention_days', String(days), actorId);
  await logAccess(env.REPORTS_DB, { caseId: null, actorId, action: 'settings.changed', detail: { retentionDays: { from: before, to: days } } });
  return readSettings(env);
}

const sha256Hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A new webhook secret: shown once, stored as its SHA-256. Replaces the old one. */
export async function generateWebhookSecret(env: CsamEnv, actorId: string): Promise<{ secret: string; webhookUrl: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await putSetting(env.REPORTS_DB, 'webhook_secret_sha256', await sha256Hex(secret), actorId);
  await logAccess(env.REPORTS_DB, { caseId: null, actorId, action: 'webhook.secret.generated' });
  return { secret, webhookUrl: webhookUrlFor(env) };
}

/** Constant-time check of Cloudflare's `cf-webhook-auth` header against the stored hash. */
export async function webhookSecretMatches(db: Db, provided: string | null | undefined): Promise<boolean> {
  const stored = await setting(db, 'webhook_secret_sha256');
  if (!stored || !provided || provided.length > 256) return false;
  const given = await sha256Hex(provided);
  let diff = given.length ^ stored.length;
  for (let i = 0; i < Math.max(given.length, stored.length); i++) diff |= (given.charCodeAt(i) || 0) ^ (stored.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// The access log (append-only: the table refuses updates and deletes)
// ---------------------------------------------------------------------------

export async function logAccess(db: Db, entry: { caseId: string | null; actorId: string; action: CsamAccessAction; detail?: Record<string, unknown> }): Promise<void> {
  await db
    .prepare('INSERT INTO csam_access_log (id, case_id, actor_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), entry.caseId, entry.actorId, entry.action, entry.detail ? JSON.stringify(entry.detail) : null, nowIso())
    .run();
}

export async function accessLog(db: Db, caseId: string | null, limit = 200): Promise<CsamAccessLogEntry[]> {
  const { results } = await db
    .prepare(`SELECT * FROM csam_access_log WHERE ${caseId ? 'case_id = ?' : 'case_id IS NULL'} ORDER BY created_at DESC LIMIT ?`)
    .bind(...(caseId ? [caseId, limit] : [limit]))
    .all<{ id: string; case_id: string | null; actor_id: string; action: CsamAccessAction; detail: string | null; created_at: string }>();
  return (results ?? []).map((r) => ({ id: r.id, caseId: r.case_id, actorId: r.actor_id, action: r.action, detail: json(r.detail), createdAt: r.created_at }));
}

// ---------------------------------------------------------------------------
// Errors page flags
// ---------------------------------------------------------------------------

async function flag(env: CsamEnv, input: { key: string; title: string; message: string; itemId: string; itemUrl: string }): Promise<void> {
  const event = scrubEvent({
    app: 'admin-api',
    kind: 'action',
    ref: newErrorRef(),
    message: input.message,
    environment: env.ENVIRONMENT,
    occurredAt: nowIso(),
    action: { key: input.key, source: 'other', title: input.title, itemType: 'csam-case', itemId: input.itemId, itemUrl: input.itemUrl },
  });
  if (!event) return;
  try {
    const { ingestAndAlert } = await import('../endpoints/errors/ErrorsIngest');
    await ingestAndAlert(env, [event]);
  } catch (error) {
    logger.error('[CSAM] Could not flag the Errors page', { key: input.key, error: error instanceof Error ? error.message : String(error) });
  }
}

async function resolveFlag(env: CsamEnv, key: string): Promise<void> {
  try {
    const { enqueueIngest } = await import('../endpoints/errors/ErrorsIngest');
    await enqueueIngest(env, { v: 1, events: [], resolved: [key], trustedRetry: true, receivedAt: nowIso() });
  } catch (error) {
    logger.error('[CSAM] Could not resolve the Errors page flag', { key, error: error instanceof Error ? error.message : String(error) });
  }
}

export const reportFlagKey = (caseId: string) => `csam:${caseId}`;
const caseUrl = (caseId: string) => `/moderation/csam/${caseId}`;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

async function getCase(db: Db, id: string): Promise<CaseRow> {
  if (!CASE_ID.test(id)) throw new CsamError(404, 'not_found');
  const row = await db.prepare('SELECT * FROM csam_cases WHERE id = ?').bind(id).first<CaseRow>();
  if (!row) throw new CsamError(404, 'not_found');
  return row;
}

async function updateCase(db: Db, id: string, fields: Partial<Omit<CaseRow, 'id'>>): Promise<void> {
  const entries = Object.entries({ ...fields, updated_at: nowIso() });
  await db
    .prepare(`UPDATE csam_cases SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...entries.map(([, v]) => v ?? null), id)
    .run();
}

function summaryOf(row: CaseRow, days: number): CsamCaseSummary {
  return {
    id: row.id,
    matchedUrl: row.matched_url,
    source: row.source,
    status: row.status,
    itemKind: (row.item_kind as CsamCaseSummary['itemKind']) ?? null,
    uploaderId: row.uploader_id,
    detectedAt: row.detected_at,
    reportedAt: row.reported_at,
    legalHold: row.legal_hold === 1,
    evidenceDeletedAt: row.evidence_deleted_at,
    retainUntil: row.evidence_deleted_at ? null : csamRetainUntil({ reportedAt: row.reported_at, legalHold: row.legal_hold === 1 }, days),
  };
}

export async function listCases(env: CsamEnv, query: { status?: string; limit?: number }): Promise<CsamCaseSummary[]> {
  const days = await retentionDays(env.REPORTS_DB);
  const limit = Math.min(Math.max(1, query.limit ?? 100), 200);
  const { results } = query.status
    ? await env.REPORTS_DB.prepare('SELECT * FROM csam_cases WHERE status = ? ORDER BY created_at DESC LIMIT ?').bind(query.status, limit).all<CaseRow>()
    : await env.REPORTS_DB.prepare('SELECT * FROM csam_cases ORDER BY created_at DESC LIMIT ?').bind(limit).all<CaseRow>();
  return (results ?? []).map((r) => summaryOf(r, days));
}

/** What the CyberTipline asks for, read from the records while they still exist. */
async function captureFacts(env: CsamEnv, matchedUrl: string, detectedAt: string, r: CsamResolution | null): Promise<CsamReportFacts> {
  const quiet = async <T>(path: string): Promise<T | null> => {
    try {
      return await callVideos<T>(env, path);
    } catch (error) {
      if (!(error instanceof VideosError && error.status === 404)) logger.warn('[CSAM] Could not read a record for the report facts', { path, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };
  const user = r?.uploaderId ? await quiet<AdminUserDetail>(`/users/${encodeURIComponent(r.uploaderId)}`) : null;
  const channel = r?.channelId ? await quiet<AdminChannelDetail>(`/channels/${encodeURIComponent(r.channelId)}`) : null;
  const video = r?.videoId ? await quiet<AdminVideoDetail>(`/videos/${encodeURIComponent(r.videoId)}`) : null;
  return {
    matchedUrl,
    detectedAt,
    incidentTimeZone: 'UTC',
    itemKind: r?.kind ?? 'video',
    itemId: r?.videoId ?? r?.postId ?? r?.imagePath ?? null,
    uploadedAt: video?.createdAt ?? null,
    uploader: {
      userId: r?.uploaderId ?? null,
      email: user?.email ?? null,
      displayName: user?.displayName ?? null,
      handle: user?.userName ?? null,
      channelId: r?.channelId ?? null,
      channelName: channel?.name ?? null,
      ipAddress: null,
    },
    evidenceFiles: [],
  };
}

/** Bans on videos at once, and asks Auth to sign the account out everywhere and suspend it. */
async function freezeUploader(env: CsamEnv, row: CaseRow, uploaderId: string, actorId: string): Promise<CsamFreezeState> {
  const state: CsamFreezeState = json<CsamFreezeState>(row.freeze) ?? {};
  try {
    if (!state.ban) {
      try {
        await callVideos(env, `/users/${encodeURIComponent(uploaderId)}/ban`, { method: 'POST', json: { reason: `CSAM match (case ${row.id})` }, actorId });
        state.ban = 'banned';
      } catch (error) {
        if (error instanceof VideosError && error.status === 409) state.ban = 'already_banned';
        else throw error;
      }
    }
    for (const action of ['revoke_sessions', 'suspend_account'] as const) {
      const field = action === 'revoke_sessions' ? 'revokeSessions' : 'suspendAccount';
      if (state[field]) continue;
      const key = `csam:${row.id}:${action}`;
      const existing = await env.REPORTS_DB.prepare('SELECT id FROM auth_moderation_requests WHERE idempotency_key = ?').bind(key).first<{ id: string }>();
      const id = existing?.id ?? `areq_${crypto.randomUUID().replace(/-/g, '')}`;
      if (!existing) {
        await insertSending(env.REPORTS_DB as never, {
          id,
          subject_user_id: uploaderId,
          action,
          reason_category: 'sexual_content',
          reason: `CSAM match (case ${row.id}). The content was taken down and reported to NCMEC by the videos admin.`,
          // The user's admin page only: never a link to the matched content
          evidence: buildEvidence({ adminWebUrl: env.ADMIN_WEB_URL, subjectUserId: uploaderId }),
          requested_by_id: actorId,
          requested_by_name: 'CSAM response',
          idempotency_key: key,
        });
        await enqueueSend(env as never, { id, subject_user_id: uploaderId }, actorId);
      }
      state[field] = id;
    }
    delete state.error;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    await flag(env, { key: `csam-freeze:${row.id}`, title: 'CSAM case: uploader not frozen', message: `Case ${row.id}: freezing the uploader failed (${state.error}). Retry from the case page.`, itemId: row.id, itemUrl: caseUrl(row.id) });
  }
  await updateCase(env.REPORTS_DB, row.id, { freeze: JSON.stringify(state) });
  if (!state.error) await resolveFlag(env, `csam-freeze:${row.id}`);
  return state;
}

/** Starts the takedown of a mapped case and freezes its uploader. */
async function containCase(env: CsamEnv, row: CaseRow, resolution: CsamResolution, actorId: string): Promise<void> {
  const facts = await captureFacts(env, row.matched_url, row.detected_at, resolution);
  const out = await callVideos<{ job: { id: string } }>(env, '/contain', { ...csam, method: 'POST', json: { caseId: row.id, matchedUrl: row.matched_url, resolution }, actorId });
  await updateCase(env.REPORTS_DB, row.id, {
    status: 'containing',
    resolution: JSON.stringify(resolution),
    item_kind: resolution.kind,
    uploader_id: resolution.uploaderId,
    job_id: out.job.id,
    facts: JSON.stringify(facts),
  });
  if (resolution.uploaderId) await freezeUploader(env, { ...row, freeze: null }, resolution.uploaderId, actorId);
}

/**
 * Opens one case per matched URL in the text (a pasted email, a list, a webhook body). URLs with an
 * open case join it; a mapped URL is taken down at once; the rest wait for a hand mapping.
 */
export async function openCases(env: CsamEnv, input: { text: string; source: 'paste' | 'webhook'; actorId: string }): Promise<{ cases: CsamCaseSummary[]; existing: string[]; notOurs: number }> {
  const urls = extractCsamUrls(input.text.slice(0, 256 * 1024)).slice(0, MAX_URLS);
  const days = await retentionDays(env.REPORTS_DB);
  const cases: CsamCaseSummary[] = [];
  const existing: string[] = [];
  let notOurs = 0;
  for (const url of urls) {
    const key = csamUrlKey(url);
    if (!key) {
      notOurs++;
      continue;
    }
    const open = await env.REPORTS_DB.prepare("SELECT * FROM csam_cases WHERE url_key = ? AND status != 'closed'").bind(key).first<CaseRow>();
    if (open) {
      existing.push(open.id);
      continue;
    }
    const resolved = await callVideos<{ ok: boolean; reason?: string; resolution?: CsamResolution }>(env, '/resolve', { ...csam, method: 'POST', json: { url } });
    if (!resolved.ok && resolved.reason === 'not_ours') {
      notOurs++;
      continue;
    }
    const at = nowIso();
    const id = crypto.randomUUID();
    const inserted = await env.REPORTS_DB
      .prepare("INSERT OR IGNORE INTO csam_cases (id, matched_url, url_key, source, status, detected_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'unmapped', ?, ?, ?, ?)")
      .bind(id, url, key, input.source, at, input.actorId, at, at)
      .run();
    if (!(inserted as { meta?: { changes?: number } }).meta?.changes) {
      const raced = await env.REPORTS_DB.prepare("SELECT id FROM csam_cases WHERE url_key = ? AND status != 'closed'").bind(key).first<{ id: string }>();
      if (raced) existing.push(raced.id);
      continue;
    }
    await logAccess(env.REPORTS_DB, { caseId: id, actorId: input.actorId, action: 'case.opened', detail: { source: input.source } });
    let row = await getCase(env.REPORTS_DB, id);
    if (resolved.ok && resolved.resolution) {
      try {
        await containCase(env, row, resolved.resolution, input.actorId);
      } catch (error) {
        logger.error('[CSAM] Takedown could not start', { caseId: id, error: error instanceof Error ? error.message : String(error) });
        await updateCase(env.REPORTS_DB, id, { status: 'containment_failed' });
        await flag(env, { key: `csam-contain:${id}`, title: 'CSAM takedown did not start', message: `Case ${id}: the takedown could not start. Retry from the case page.`, itemId: id, itemUrl: caseUrl(id) });
      }
      row = await getCase(env.REPORTS_DB, id);
    } else {
      await updateCase(env.REPORTS_DB, id, { facts: JSON.stringify(await captureFacts(env, url, at, null)) });
    }
    await flag(env, {
      key: reportFlagKey(id),
      title: 'CSAM match: report to the NCMEC CyberTipline',
      message: row.status === 'unmapped' ? `Case ${id}: map the URL to its item, then report it.` : `Case ${id}: the item is being taken down; report it to the CyberTipline.`,
      itemId: id,
      itemUrl: caseUrl(id),
    });
    cases.push(summaryOf(row, days));
  }
  return { cases, existing, notOurs };
}

/** A super admin's mapping of an unmapped case (validated by api-videos against the stores). */
export async function mapCase(env: CsamEnv, id: string, input: unknown, actorId: string): Promise<CsamCaseSummary> {
  const row = await getCase(env.REPORTS_DB, id);
  if (row.status !== 'unmapped') throw new CsamError(409, 'already_mapped');
  const resolution = await callVideos<CsamResolution>(env, '/resolve-by-hand', { ...csam, method: 'POST', json: input });
  await logAccess(env.REPORTS_DB, { caseId: id, actorId, action: 'case.mapped', detail: { kind: resolution.kind } });
  await containCase(env, row, resolution, actorId);
  return summaryOf(await getCase(env.REPORTS_DB, id), await retentionDays(env.REPORTS_DB));
}

/** The takedown job's state, brought onto the case. */
async function syncJob(env: CsamEnv, row: CaseRow): Promise<CsamTakedownJob | null> {
  if (!row.job_id) return null;
  let job: { id: string; status: CsamTakedownJob['status']; attempts: number; lastError: string | null; result: Record<string, unknown> | null; params?: { phase?: string } } | null = null;
  try {
    job = (await callVideos<{ job: typeof job }>(env, `/cases/${row.id}/job`, csam)).job;
  } catch (error) {
    logger.warn('[CSAM] Could not read the takedown job', { caseId: row.id, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  if (!job) return null;
  if (row.status === 'containing' || row.status === 'containment_failed') {
    const status: CsamCaseStatus = job.status === 'succeeded' ? 'contained' : job.status === 'failed' ? 'containment_failed' : 'containing';
    if (status !== row.status) await updateCase(env.REPORTS_DB, row.id, { status });
    row.status = status;
  }
  return { id: job.id, status: job.status, phase: (job.result?.phase as string | undefined) ?? job.params?.phase ?? null, attempts: job.attempts, lastError: job.lastError, result: job.result };
}

async function authRequestsOf(env: CsamEnv, freeze: CsamFreezeState | null): Promise<CsamAuthRequestState[]> {
  const out: CsamAuthRequestState[] = [];
  for (const [action, id] of [['revoke_sessions', freeze?.revokeSessions], ['suspend_account', freeze?.suspendAccount]] as const) {
    if (!id) continue;
    const row = (await getRow(env.REPORTS_DB as never, id)) as MirrorRow | null;
    out.push({ id, action, status: row?.status ?? null, deliveryStatus: row?.delivery_status ?? 'unknown' });
  }
  return out;
}

export async function caseDetail(env: CsamEnv, id: string, actorId: string): Promise<CsamCaseDetail> {
  const row = await getCase(env.REPORTS_DB, id);
  const job = await syncJob(env, row);
  let manifest: CsamEvidenceManifest | null = null;
  if (!row.evidence_deleted_at && row.job_id) {
    try {
      manifest = await callVideos<CsamEvidenceManifest>(env, `/cases/${row.id}/manifest`, csam);
    } catch (error) {
      if (!(error instanceof VideosError && error.status === 404)) logger.warn('[CSAM] Could not read the evidence manifest', { caseId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const freeze = json<CsamFreezeState>(row.freeze);
  const facts = json<CsamReportFacts>(row.facts) ?? (await captureFacts(env, row.matched_url, row.detected_at, json<CsamResolution>(row.resolution)));
  const files = (manifest?.files ?? []).map((f) => ({ name: f.name, bytes: f.bytes, contentType: f.contentType, source: f.source }));
  await logAccess(env.REPORTS_DB, { caseId: id, actorId, action: 'case.viewed', detail: manifest ? { manifest: true } : undefined });
  return {
    ...summaryOf(row, await retentionDays(env.REPORTS_DB)),
    resolution: json<CsamResolution>(row.resolution),
    createdBy: row.created_by,
    reportId: row.report_id,
    reportedBy: row.reported_by,
    legalHoldReason: row.legal_hold_reason,
    freeze,
    authRequests: await authRequestsOf(env, freeze),
    job,
    evidence: manifest ? { files, missing: manifest.missing.map((m) => ({ name: m.name, reason: m.reason })), completedAt: manifest.completedAt ?? null } : null,
    facts: { ...facts, evidenceFiles: files.map((f) => ({ name: f.name, bytes: f.bytes, contentType: f.contentType })) },
  };
}

/** One evidence file, decrypted by api-videos, as an attachment. Logged before it leaves. */
export async function downloadEvidence(env: CsamEnv, id: string, name: string, actorId: string): Promise<Response> {
  const row = await getCase(env.REPORTS_DB, id);
  if (row.evidence_deleted_at) throw new CsamError(404, 'evidence_deleted');
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(name)) throw new CsamError(400, 'invalid_name');
  await logAccess(env.REPORTS_DB, { caseId: id, actorId, action: 'file.downloaded', detail: { name } });
  const upstream = await fetchVideosRaw(env, `/cases/${id}/files/${encodeURIComponent(name)}`, { ...csam, actorId });
  if (!upstream.ok) throw new CsamError(upstream.status === 404 ? 404 : 503, upstream.status === 404 ? 'not_found' : 'evidence_unavailable');
  const headers = new Headers();
  for (const h of ['content-type', 'content-disposition', 'content-length']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store, private');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  return new Response(upstream.body, { status: 200, headers });
}

export async function retryCase(env: CsamEnv, id: string, actorId: string): Promise<CsamCaseSummary> {
  const row = await getCase(env.REPORTS_DB, id);
  await logAccess(env.REPORTS_DB, { caseId: id, actorId, action: 'takedown.retried' });
  const resolution = json<CsamResolution>(row.resolution);
  if (!row.job_id && resolution) await containCase(env, row, resolution, actorId);
  else if (row.job_id) {
    await callVideos(env, '/retry', { ...csam, method: 'POST', json: { caseId: id }, actorId });
    if (row.status === 'containment_failed') await updateCase(env.REPORTS_DB, id, { status: 'containing' });
  }
  const fresh = await getCase(env.REPORTS_DB, id);
  if (fresh.uploader_id && json<CsamFreezeState>(fresh.freeze)?.error) await freezeUploader(env, fresh, fresh.uploader_id, actorId);
  return summaryOf(await getCase(env.REPORTS_DB, id), await retentionDays(env.REPORTS_DB));
}

export async function markReported(env: CsamEnv, id: string, input: { reportId?: unknown; reportedAt?: unknown }, actorId: string): Promise<CsamCaseSummary> {
  const row = await getCase(env.REPORTS_DB, id);
  if (row.status === 'unmapped') throw new CsamError(409, 'not_mapped', 'Map the URL to its item first');
  if (row.status === 'closed') throw new CsamError(409, 'closed');
  const reportId = typeof input.reportId === 'string' ? input.reportId.trim() : '';
  if (!REPORT_ID.test(reportId)) throw new CsamError(400, 'invalid_report_id');
  const at = typeof input.reportedAt === 'string' && !Number.isNaN(Date.parse(input.reportedAt)) ? new Date(input.reportedAt) : new Date();
  if (at.getTime() > Date.now() + 5 * 60_000 || at.getTime() < Date.parse(row.detected_at) - 86_400_000) throw new CsamError(400, 'invalid_reported_at');
  await updateCase(env.REPORTS_DB, id, { status: 'reported', report_id: reportId, reported_at: at.toISOString(), reported_by: actorId });
  await logAccess(env.REPORTS_DB, { caseId: id, actorId, action: 'case.reported', detail: { reportId, reportedAt: at.toISOString(), ...(row.report_id ? { replaces: row.report_id } : {}) } });
  await resolveFlag(env, reportFlagKey(id));
  return summaryOf(await getCase(env.REPORTS_DB, id), await retentionDays(env.REPORTS_DB));
}

export async function setLegalHold(env: CsamEnv, id: string, input: { on?: unknown; reason?: unknown }, actorId: string): Promise<CsamCaseSummary> {
  const row = await getCase(env.REPORTS_DB, id);
  if (row.evidence_deleted_at) throw new CsamError(409, 'evidence_deleted');
  const on = input.on === true;
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : '';
  if (!reason) throw new CsamError(400, 'reason_required');
  await updateCase(env.REPORTS_DB, id, { legal_hold: on ? 1 : 0, legal_hold_reason: on ? reason : null });
  await logAccess(env.REPORTS_DB, { caseId: id, actorId, action: on ? 'hold.set' : 'hold.lifted', detail: { reason } });
  return summaryOf(await getCase(env.REPORTS_DB, id), await retentionDays(env.REPORTS_DB));
}

/**
 * The daily retention sweep: evidence of reported cases past report + retention days, with no
 * hold, is deleted in api-videos; the case and its log stay (closed). Failures flag the admin.
 */
export async function runCsamRetention(env: CsamEnv, now = new Date()): Promise<{ deleted: number; failed: number }> {
  const days = await retentionDays(env.REPORTS_DB);
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const { results } = await env.REPORTS_DB
    .prepare('SELECT * FROM csam_cases WHERE reported_at IS NOT NULL AND reported_at <= ? AND legal_hold = 0 AND evidence_deleted_at IS NULL ORDER BY reported_at LIMIT 20')
    .bind(cutoff)
    .all<CaseRow>();
  let deleted = 0;
  let failed = 0;
  for (const row of results ?? []) {
    // Re-checked per case with the shared rule (never before a report, never under a hold)
    const until = csamRetainUntil({ reportedAt: row.reported_at, legalHold: row.legal_hold === 1 }, days);
    if (!until || Date.parse(until) > now.getTime()) continue;
    try {
      const out = await callVideos<{ deleted: number }>(env, `/cases/${row.id}/evidence`, { ...csam, method: 'DELETE', actorId: RETENTION_ACTOR });
      await updateCase(env.REPORTS_DB, row.id, { evidence_deleted_at: now.toISOString(), status: 'closed' });
      await logAccess(env.REPORTS_DB, { caseId: row.id, actorId: RETENTION_ACTOR, action: 'evidence.deleted', detail: { objects: out.deleted, retentionDays: days } });
      deleted++;
    } catch (error) {
      failed++;
      await flag(env, { key: `csam-retention:${row.id}`, title: 'CSAM evidence retention: delete failed', message: `Case ${row.id}: the evidence past its retention could not be deleted (${error instanceof Error ? error.message : String(error)}). The sweep tries again daily.`, itemId: row.id, itemUrl: caseUrl(row.id) });
    }
  }
  return { deleted, failed };
}

/** Is it the daily retention tick (the first scheduled run after 03:00 UTC)? */
export function isCsamRetentionTick(scheduledTime: number): boolean {
  const d = new Date(scheduledTime);
  return d.getUTCHours() === 3 && d.getUTCMinutes() < 5;
}

/** The Cloudflare Notifications webhook: signed; our URLs open cases, anything else only flags. */
export async function handleCloudflareWebhook(env: CsamEnv, input: { secret: string | null | undefined; body: string }): Promise<{ status: 200 | 401 | 413; opened?: number }> {
  if (!(await webhookSecretMatches(env.REPORTS_DB, input.secret))) return { status: 401 };
  if (input.body.length > 256 * 1024) return { status: 413 };
  const out = await openCases(env, { text: input.body, source: 'webhook', actorId: WEBHOOK_ACTOR });
  if (out.cases.length || out.existing.length) return { status: 200, opened: out.cases.length };
  let alertType = 'unknown';
  try {
    const parsed = JSON.parse(input.body) as { alert_type?: unknown; name?: unknown };
    alertType = typeof parsed.alert_type === 'string' ? parsed.alert_type.slice(0, 80) : typeof parsed.name === 'string' ? parsed.name.slice(0, 80) : 'unknown';
  } catch {
    alertType = 'not JSON';
  }
  const digest = (await sha256Hex(input.body)).slice(0, 16);
  await flag(env, {
    key: `csam-webhook:${digest}`,
    title: 'Cloudflare notification without a match',
    message: `A signed Cloudflare notification (${alertType}, ${input.body.length} bytes) named none of our URLs. If it was a block, paste the CSAM email on the CSAM page.`,
    itemId: digest,
    itemUrl: '/moderation/csam',
  });
  return { status: 200, opened: 0 };
}
