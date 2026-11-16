/**
 * /api/email-templates/* — videos admin › Settings › Emails (shared-types email-templates.ts).
 * Behind authMiddleware + adminMiddleware (src/index.ts); every route needs `emails:manage`
 * (Super Admin and Admin). Every change is recorded in admin_audit_log.
 *
 *   GET  /                          the templates with their current version
 *   GET  /:key                      the current version (copy in en + ar, default videos)
 *   PUT  /:key                      { baseVersion, content } → a new version (409 conflict when stale)
 *   GET  /:key/versions?before=     saved versions, newest first
 *   POST /:key/restore              { version, baseVersion, undo? } → a new version with that content
 *   POST /:key/preview              { content, locale, sample? } → { subject, html, text, issues }
 *   POST /:key/test                 { content, locale } → emails it to the signed-in admin, marked as a
 *                                   test (EMAIL_TEST_SENDS_PER_HOUR per admin)
 *   GET  /creator_invite/default-videos   { en, ar }: the default invite videos as picker items (or null),
 *                                   to prefill a new invite's video pickers; also open to users:manage
 *                                   (whoever may invite). Clearing a picker on an invite means no video.
 */
import { Hono, type Context } from 'hono';
import {
  EMAIL_TEMPLATES,
  EMAIL_TEST_SENDS_PER_HOUR,
  checkEmailTemplate,
  cleanEmailTemplate,
  hasContentPermission,
  isEmailTemplateKey,
  type AdminPage,
  type AdminSuggestion,
  type AdminVideoRow,
  type EmailTemplateContent,
  type EmailTemplateDef,
  type EmailTemplateIssue,
  type EmailTemplateKey,
  type EmailTemplateLang,
} from '@al-ummah/shared-types';
import type { AdminBindings, AuthContext } from '../base/types';
import { audit } from '../lib/authModeration';
import { callVideos, type VideosClientEnv } from '../lib/content/videosClient';
import { envTag, sendContactEmail, type MailerEnv } from '../lib/contact-email';
import { getTemplate, getVersion, listTemplates, listVersions, TemplateConflictError, testSendsInLastHour, writeVersion } from '../lib/email-templates';
import { renderInviteFromCopy, type InviteChannelInfo, type InviteEmailData, type InviteVideoInfo } from '../lib/email/invite';
import type { EmailBlock } from '../lib/email/layout';
import { videosWebOrigin } from '../lib/invites';
import { logger } from '../lib/logger';
import { hasPermission, normalizeRoles } from '../lib/roles';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const emailOf = (c: C) => c.get('auth')?.email ?? null;

const DEFAULT_VIDEOS_PATH = /\/creator_invite\/default-videos$/;

app.use('*', async (c, next) => {
  const roles = c.get('auth')?.roles;
  if (c.req.method === 'GET' && DEFAULT_VIDEOS_PATH.test(c.req.path) && hasContentPermission(roles, 'users:manage')) return next();
  if (!hasPermission(normalizeRoles(c.get('auth')?.roles), 'emails:manage')) {
    logger.warn('[EmailTemplates] Permission denied', { userId: actorOf(c), path: c.req.path });
    return c.json({ success: false, code: 'forbidden', error: 'The emails:manage permission is required' }, 403);
  }
  return next();
});

app.onError((error, c) => {
  logger.error('[EmailTemplates] Request failed', { path: c.req.path, error: error instanceof Error ? error.message : String(error) });
  return c.json({ success: false, code: 'internal_error', error: 'Internal error' }, 500);
});

const bad = (c: C, code: string, extra: Record<string, unknown> = {}) => c.json({ success: false, code, error: code, ...extra }, 400);
const notFound = (c: C) => c.json({ success: false, code: 'not_found', error: 'No such template' }, 404);
const conflict = (c: C, current: number) => c.json({ success: false, code: 'conflict', error: 'The template changed since it was opened', current }, 409);
/** Issues as `{ "<lang>.<field>": code }` too, the shape admin-web's client reads (first issue per field). */
const invalid = (c: C, issues: EmailTemplateIssue[]) => {
  const fields: Record<string, string> = {};
  for (const i of issues) fields[`${i.lang}.${i.field}`] ??= i.code;
  return bad(c, 'invalid_template', { issues, fields });
};
const langOf = (v: unknown): EmailTemplateLang => (v === 'ar' ? 'ar' : 'en');

function defOf(c: C): { key: EmailTemplateKey; def: EmailTemplateDef } | null {
  const key = c.req.param('key') ?? '';
  return isEmailTemplateKey(key) ? { key, def: EMAIL_TEMPLATES[key] } : null;
}

/**
 * Default videos must be public, visible and not deleted: the invite's card links to them. A
 * video api-videos cannot find is refused too.
 */
export async function checkDefaultVideos(env: VideosClientEnv, content: EmailTemplateContent, actorId: string): Promise<EmailTemplateIssue[]> {
  const issues: EmailTemplateIssue[] = [];
  for (const lang of ['en', 'ar'] as const) {
    const id = content.defaultVideos?.[lang];
    if (!id) continue;
    if (!(await findPublicVideo(env, id, actorId))) issues.push({ field: 'defaultVideo', lang, code: 'invalid_video' });
  }
  return issues;
}

/** A public, visible video by id from the admin video list, or null. */
async function findPublicVideo(env: VideosClientEnv, id: string, actorId: string): Promise<AdminVideoRow | null> {
  const page = await callVideos<AdminPage<AdminVideoRow>>(env, '/videos', { query: { q: id, pageSize: 5 }, actorId });
  const video = page.items.find((v) => v.id === id);
  return video && video.isPublic && !video.isHidden && !video.isDeleted ? video : null;
}

app.get('/creator_invite/default-videos', async (c) => {
  const state = await getTemplate(c.env.REPORTS_DB, 'creator_invite');
  const out: Record<EmailTemplateLang, AdminSuggestion | null> = { en: null, ar: null };
  for (const lang of ['en', 'ar'] as const) {
    const id = state?.content.defaultVideos?.[lang];
    if (!id) continue;
    const v = await findPublicVideo(c.env as unknown as VideosClientEnv, id, actorOf(c)).catch(() => null);
    // A default that is no longer public prefills nothing
    if (v) out[lang] = { kind: 'video', id: v.id, label: v.title || v.id, secondary: v.channelName ?? undefined, imageUrl: v.thumbnailUrl ?? undefined } as AdminSuggestion;
  }
  return c.json({ success: true, result: out });
});

/** The preview's video card for a default video: the web app's stable picture and watch pages. */
async function previewVideo(c: C, id: string | null | undefined): Promise<InviteVideoInfo | null> {
  if (!id) return null;
  const v = await findPublicVideo(c.env as unknown as VideosClientEnv, id, actorOf(c)).catch(() => null);
  if (!v) return null;
  const origin = videosWebOrigin(c.env) ?? 'https://videos.alummahnow.net';
  return { title: v.title, channel: v.channelName, imageUrl: `${origin}/og/v/${v.id}.jpg`, urls: { en: `${origin}/en/video/${v.id}`, ar: `${origin}/ar/video/${v.id}` } };
}

app.get('/', async (c) => c.json({ success: true, result: { items: await listTemplates(c.env.REPORTS_DB) } }));

app.get('/:key', async (c) => {
  const t = defOf(c);
  if (!t) return notFound(c);
  const state = await getTemplate(c.env.REPORTS_DB, t.key);
  return state ? c.json({ success: true, result: state }) : notFound(c);
});

app.put('/:key', async (c) => {
  const t = defOf(c);
  if (!t) return notFound(c);
  const body = (await c.req.json().catch(() => null)) as { baseVersion?: unknown; content?: unknown } | null;
  if (!body || !Number.isInteger(body.baseVersion)) return bad(c, 'invalid_request');
  const issues = checkEmailTemplate(t.def, body.content);
  if (issues.length) return invalid(c, issues);
  const content = cleanEmailTemplate(t.def, body.content as EmailTemplateContent);
  const videoIssues = t.def.defaultVideos ? await checkDefaultVideos(c.env as unknown as VideosClientEnv, content, actorOf(c)) : [];
  if (videoIssues.length) return invalid(c, videoIssues);
  try {
    const state = await writeVersion(c.env.REPORTS_DB, t.key, { baseVersion: body.baseVersion as number, content, action: 'save', actorId: actorOf(c) });
    await audit(c.env.REPORTS_DB, {
      actorId: actorOf(c),
      actorEmail: emailOf(c),
      action: 'email_template.saved',
      targetType: 'email_template',
      targetId: t.key,
      metadata: { version: state.version, from: body.baseVersion },
    });
    logger.info('[EmailTemplates] Saved', { key: t.key, version: state.version, actorId: actorOf(c) });
    return c.json({ success: true, result: state });
  } catch (error) {
    if (error instanceof TemplateConflictError) return conflict(c, error.current);
    throw error;
  }
});

app.get('/:key/versions', async (c) => {
  const t = defOf(c);
  if (!t) return notFound(c);
  const before = Number(c.req.query('before'));
  const limit = Number(c.req.query('limit'));
  const items = await listVersions(c.env.REPORTS_DB, t.key, { before: Number.isInteger(before) ? before : undefined, limit: Number.isInteger(limit) ? limit : undefined });
  const last = items[items.length - 1];
  return c.json({ success: true, result: { items, next: last && last.version > 1 && items.length ? last.version : null } });
});

app.post('/:key/restore', async (c) => {
  const t = defOf(c);
  if (!t) return notFound(c);
  const body = (await c.req.json().catch(() => null)) as { version?: unknown; baseVersion?: unknown; undo?: unknown } | null;
  if (!body || !Number.isInteger(body.version) || !Number.isInteger(body.baseVersion)) return bad(c, 'invalid_request');
  const source = await getVersion(c.env.REPORTS_DB, t.key, body.version as number);
  if (!source) return c.json({ success: false, code: 'not_found', error: 'No such version' }, 404);
  const undo = body.undo === true;
  try {
    const state = await writeVersion(c.env.REPORTS_DB, t.key, {
      baseVersion: body.baseVersion as number,
      content: source.content,
      action: undo ? 'undo' : 'restore',
      sourceVersion: source.version,
      actorId: actorOf(c),
    });
    await audit(c.env.REPORTS_DB, {
      actorId: actorOf(c),
      actorEmail: emailOf(c),
      action: undo ? 'email_template.undone' : 'email_template.restored',
      targetType: 'email_template',
      targetId: t.key,
      metadata: { version: state.version, restoredFrom: source.version, from: body.baseVersion },
    });
    return c.json({ success: true, result: state });
  } catch (error) {
    if (error instanceof TemplateConflictError) return conflict(c, error.current);
    throw error;
  }
});

type Sample = 'none' | 'one' | 'many' | 'transferred';
const SAMPLE_NAMES = { en: { name: 'Aisha Rahman', channels: ['Daily Reminders', 'Friday Khutbahs'] }, ar: { name: 'عائشة الرحمن', channels: ['تذكير يومي', 'خطب الجمعة'] } };

/** The made-up invite the preview and the test email show (never a real person). */
export function sampleInvite(lang: EmailTemplateLang, opts: { channels?: Sample; withName?: boolean; withNote?: boolean; link: string; email?: string }, now = Date.now()): InviteEmailData {
  const s = SAMPLE_NAMES[lang];
  const kind = opts.channels ?? 'one';
  const channels: InviteChannelInfo[] =
    kind === 'none' ? [] : kind === 'one' ? [{ name: s.channels[0]!, action: 'created' }] : kind === 'many' ? s.channels.map((name) => ({ name, action: 'created' })) : [{ name: s.channels[1]!, action: 'transferred' }];
  return {
    email: opts.email ?? 'creator@example.com',
    name: opts.withName === false ? null : s.name,
    link: opts.link,
    expiresAt: now + 14 * 24 * 60 * 60 * 1000,
    note: opts.withNote ? (lang === 'ar' ? 'أهلًا بك، يسعدنا انضمامك.' : 'Welcome aboard, we are glad to have you.') : null,
    locale: lang,
    channels,
  };
}

const TEST_COPY = {
  en: { prefix: '[Test] ', banner: 'This is a test of the creator invite email, sent from Settings › Emails. The button does not accept an invite.' },
  ar: { prefix: '[تجربة] ', banner: 'هذه رسالة تجريبية لبريد دعوة صانع المحتوى، أُرسلت من الإعدادات › رسائل البريد. الزر لا يقبل أي دعوة.' },
} as const;

function contentFrom(def: EmailTemplateDef, raw: unknown): EmailTemplateContent {
  return cleanEmailTemplate(def, (raw && typeof raw === 'object' ? raw : { copy: { en: {}, ar: {} } }) as EmailTemplateContent);
}

app.post('/:key/preview', async (c) => {
  const t = defOf(c);
  if (!t) return notFound(c);
  const body = (await c.req.json().catch(() => null)) as { content?: unknown; locale?: unknown; sample?: { channels?: Sample; withName?: boolean; withNote?: boolean } } | null;
  if (!body) return bad(c, 'invalid_request');
  const lang = langOf(body.locale);
  const issues = checkEmailTemplate(t.def, body.content).filter((i) => i.lang === lang);
  const content = contentFrom(t.def, body.content);
  const link = `${videosWebOrigin(c.env) ?? 'https://videos.alummahnow.net'}/${lang}`;
  const video = await previewVideo(c, content.defaultVideos?.[lang]);
  const rendered = renderInviteFromCopy(content.copy[lang], { ...sampleInvite(lang, { ...body.sample, link }), video });
  return c.json({ success: true, result: { ...rendered, issues } });
});

app.post('/:key/test', async (c) => {
  const t = defOf(c);
  if (!t) return notFound(c);
  const to = emailOf(c);
  if (!to) return bad(c, 'no_email');
  const body = (await c.req.json().catch(() => null)) as { content?: unknown; locale?: unknown } | null;
  if (!body) return bad(c, 'invalid_request');
  const lang = langOf(body.locale);
  const issues = checkEmailTemplate(t.def, body.content).filter((i) => i.lang === lang);
  if (issues.length) return invalid(c, issues);
  const sent = await testSendsInLastHour(c.env.REPORTS_DB, actorOf(c));
  if (sent >= EMAIL_TEST_SENDS_PER_HOUR) {
    return c.json({ success: false, code: 'rate_limited', error: 'rate_limited', limit: EMAIL_TEST_SENDS_PER_HOUR }, 429);
  }
  const content = contentFrom(t.def, body.content);
  const link = `${videosWebOrigin(c.env) ?? 'https://videos.alummahnow.net'}/${lang}`;
  const banner: EmailBlock = { kind: 'notice', text: TEST_COPY[lang].banner, tone: 'info' };
  const video = await previewVideo(c, content.defaultVideos?.[lang]);
  const rendered = renderInviteFromCopy(content.copy[lang], { ...sampleInvite(lang, { link, email: to, withNote: true }), video }, [banner]);
  const env = c.env as unknown as MailerEnv;
  const result = await sendContactEmail(env, { to, subject: `${envTag(env.ENVIRONMENT)}${TEST_COPY[lang].prefix}${rendered.subject}`, html: rendered.html, text: rendered.text });
  if (result.status === 'failed') {
    logger.error('[EmailTemplates] Test email not sent', { key: t.key, actorId: actorOf(c), error: result.error });
    return c.json({ success: false, code: 'send_failed', error: 'send_failed' }, 502);
  }
  await audit(c.env.REPORTS_DB, {
    actorId: actorOf(c),
    actorEmail: emailOf(c),
    action: 'email_template.test_sent',
    targetType: 'email_template',
    targetId: t.key,
    metadata: { locale: lang, status: result.status },
  });
  return c.json({ success: true, result: { to, status: result.status, remaining: EMAIL_TEST_SENDS_PER_HOUR - sent - 1 } });
});

export default app;
