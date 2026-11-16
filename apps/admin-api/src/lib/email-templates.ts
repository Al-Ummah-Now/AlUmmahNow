/**
 * Admin-editable system emails: storage, versions and the copy a send carries
 * (shared-types email-templates.ts; migration 0036; routers/emailTemplates.router.ts).
 *
 * Every save, restore and undo writes a new version row and moves the current row in one batch,
 * guarded by the version the admin edited (a stale editor gets `conflict`, never a silent
 * overwrite). Staff are kept by user id only.
 *
 * Sending: the invite's request to Auth carries the resolved copy for the invite's one language
 * (`resolveEmailCopy`), so Auth never reads this DB; Auth keeps its built-in copy only for a
 * request without it and logs when it uses it.
 */
import {
  EMAIL_TEMPLATES,
  type EmailTemplateContent,
  type EmailTemplateKey,
  type EmailTemplateLang,
  type EmailTemplateState,
  type EmailTemplateVersion,
  type EmailTemplateVersionAction,
  type ResolvedEmailCopy,
} from '@al-ummah/shared-types';
import { logger } from './logger';
import type { D1Database } from './types';

interface TemplateRow {
  key: string;
  version: number;
  content: string;
  updated_at: string;
  updated_by: string;
}

interface VersionRow {
  version: number;
  action: string;
  source_version: number | null;
  content: string;
  created_at: string;
  created_by: string;
}

export class TemplateConflictError extends Error {
  constructor(public current: number) {
    super('The template changed since it was opened');
  }
}

const parse = (s: string): EmailTemplateContent => JSON.parse(s) as EmailTemplateContent;

const toState = (r: TemplateRow): EmailTemplateState => ({
  key: r.key as EmailTemplateKey,
  version: r.version,
  content: parse(r.content),
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const toVersion = (r: VersionRow): EmailTemplateVersion => ({
  version: r.version,
  action: r.action as EmailTemplateVersionAction,
  sourceVersion: r.source_version,
  content: parse(r.content),
  createdAt: r.created_at,
  createdBy: r.created_by,
});

export async function getTemplate(db: D1Database, key: EmailTemplateKey): Promise<EmailTemplateState | null> {
  const row = await db.prepare('SELECT key, version, content, updated_at, updated_by FROM email_templates WHERE key = ?').bind(key).first<TemplateRow>();
  return row ? toState(row) : null;
}

export async function listTemplates(db: D1Database): Promise<Omit<EmailTemplateState, 'content'>[]> {
  const { results } = await db.prepare('SELECT key, version, content, updated_at, updated_by FROM email_templates ORDER BY key').all<TemplateRow>();
  return (results ?? []).filter((r) => r.key in EMAIL_TEMPLATES).map((r) => ({ key: r.key as EmailTemplateKey, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by }));
}

export async function getVersion(db: D1Database, key: EmailTemplateKey, version: number): Promise<EmailTemplateVersion | null> {
  const row = await db
    .prepare('SELECT version, action, source_version, content, created_at, created_by FROM email_template_versions WHERE key = ? AND version = ?')
    .bind(key, version)
    .first<VersionRow>();
  return row ? toVersion(row) : null;
}

/** Newest first; `before` pages back (a version number). */
export async function listVersions(db: D1Database, key: EmailTemplateKey, opts: { limit?: number; before?: number } = {}): Promise<EmailTemplateVersion[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const before = opts.before && opts.before > 0 ? opts.before : Number.MAX_SAFE_INTEGER;
  const { results } = await db
    .prepare('SELECT version, action, source_version, content, created_at, created_by FROM email_template_versions WHERE key = ? AND version < ? ORDER BY version DESC LIMIT ?')
    .bind(key, before, limit)
    .all<VersionRow>();
  return (results ?? []).map(toVersion);
}

/**
 * Writes `content` as the next version. `baseVersion` is the version the admin edited; when the
 * template has moved on since, nothing is written and TemplateConflictError carries the current one.
 */
export async function writeVersion(
  db: D1Database,
  key: EmailTemplateKey,
  input: { baseVersion: number; content: EmailTemplateContent; action: EmailTemplateVersionAction; sourceVersion?: number | null; actorId: string },
  now = new Date().toISOString(),
): Promise<EmailTemplateState> {
  const next = input.baseVersion + 1;
  const body = JSON.stringify(input.content);
  const results = await db.batch([
    db.prepare('UPDATE email_templates SET version = ?, content = ?, updated_at = ?, updated_by = ? WHERE key = ? AND version = ?').bind(next, body, now, input.actorId, key, input.baseVersion),
    // Only lands when the update did (the same version cannot be inserted twice: primary key)
    db
      .prepare(
        `INSERT INTO email_template_versions (key, version, content, action, source_version, created_at, created_by)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM email_templates WHERE key = ? AND version = ? AND updated_at = ?)`,
      )
      .bind(key, next, body, input.action, input.sourceVersion ?? null, now, input.actorId, key, next, now),
  ]);
  if (!(results[0]?.meta as { changes?: number } | undefined)?.changes) {
    const current = await getTemplate(db, key);
    throw new TemplateConflictError(current?.version ?? 0);
  }
  return { key, version: next, content: input.content, updatedAt: now, updatedBy: input.actorId };
}

/**
 * The copy a send carries: the template's current text in the email's one language. Null when
 * the template is missing or unreadable (the sender then uses its built-in copy and logs it).
 */
export async function resolveEmailCopy(db: D1Database, key: EmailTemplateKey, locale: string): Promise<ResolvedEmailCopy | null> {
  const lang: EmailTemplateLang = locale === 'ar' ? 'ar' : 'en';
  try {
    const t = await getTemplate(db, key);
    if (!t) {
      logger.warn('[EmailTemplates] Template missing; the sender will use its built-in copy', { key });
      return null;
    }
    return { key, version: t.version, locale: lang, copy: t.content.copy[lang] };
  } catch (error) {
    logger.error('[EmailTemplates] Template unreadable; the sender will use its built-in copy', { key, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * The default invite video for a language (Settings › Emails › Creator invite), or null. It only
 * prefills a new invite's video picker (GET /api/email-templates/creator_invite/default-videos); an
 * invite whose picker was cleared has no video, so this is never a send-time fallback.
 */
export async function getInviteDefaultVideoId(db: D1Database, locale: 'en' | 'ar'): Promise<string | null> {
  const t = await getTemplate(db, 'creator_invite').catch(() => null);
  return t?.content.defaultVideos?.[locale === 'ar' ? 'ar' : 'en'] ?? null;
}

/** Test emails this admin sent in the last hour (audit rows; idx_admin_audit_actor). */
export async function testSendsInLastHour(db: D1Database, actorId: string, now = Date.now()): Promise<number> {
  const since = new Date(now - 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM admin_audit_log WHERE actor_id = ? AND created_at > ? AND action = 'email_template.test_sent'")
    .bind(actorId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
