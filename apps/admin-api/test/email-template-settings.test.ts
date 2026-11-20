/**
 * Settings › Emails (shared-types email-templates.ts, routers/emailTemplates.router.ts): the seeded
 * creator invite is today's copy, placeholder checks, versioned saves with conflicts, restore and
 * undo, preview, the rate-limited test send, and the copy the invite request to Auth carries.
 * SQL runs on node:sqlite with the real migrations; Resend and api-videos are fetch stubs.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  CREATOR_INVITE_SEED_COPY,
  CREATOR_INVITE_TEMPLATE,
  EMAIL_TEST_SENDS_PER_HOUR,
  checkEmailField,
  checkEmailTemplate,
  fillPlaceholders,
  type EmailTemplateContent,
} from '@al-ummah/shared-types';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sqliteD1 } from './d1-sqlite';
import emailTemplatesRouter, { sampleInvite } from '../src/routers/emailTemplates.router';
import { getInviteDefaultVideoId, resolveEmailCopy } from '../src/lib/email-templates';
import { inviteEmailDocFromCopy, renderInviteFromCopy } from '../src/lib/email/invite';

const realFetch = globalThis.fetch;
let mails: Record<string, unknown>[] = [];
let videos: Record<string, unknown>[] = [];

beforeEach(() => {
  mails = [];
  videos = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.resend.com') {
      mails.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
    }
    if (u.pathname === '/internal/admin/videos') {
      const q = u.searchParams.get('q');
      return new Response(JSON.stringify({ success: true, result: { items: videos.filter((v) => v.id === q), total: 0 } }), { status: 200 });
    }
    return new Response('not stubbed', { status: 599 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function setup(roles = ['admin'], email: string | null = 'admin@example.org') {
  const db = sqliteD1();
  const env = { REPORTS_DB: db, ENVIRONMENT: 'production', RESEND_API_KEY: 'k', INTERNAL_API_KEY: 'internal', VIDEOS_API_URL: 'http://videos.test', VIDEOS_WEB_URL: 'https://videos.example' };
  const app = new Hono();
  app.use('/api/email-templates/*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', email: email ?? undefined, roles } as never);
    return next();
  });
  app.route('/api/email-templates', emailTemplatesRouter as never);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/email-templates${path}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) }, env);
    return { status: res.status, json: (await res.json()) as { success: boolean; code?: string; result?: any; issues?: any[]; current?: number } };
  };
  return { db, env, api };
}

const seedContent = (): EmailTemplateContent => ({ copy: structuredClone(CREATOR_INVITE_SEED_COPY), defaultVideos: { en: null, ar: null } });

describe('the seeded creator invite', () => {
  it('is version 2 (the seed, then the one-time-link wording of 0045) with the default copy, and passes its own checks', async () => {
    const { api } = setup();
    const { json } = await api('GET', '/creator_invite');
    assert.equal(json.result.version, 2);
    assert.deepEqual(json.result.content, seedContent());
    assert.deepEqual(checkEmailTemplate(CREATOR_INVITE_TEMPLATE, json.result.content), []);
  });

  it('renders the same words as Auth sends with its built-in copy', () => {
    const at = Date.UTC(2026, 10, 30);
    const doc = inviteEmailDocFromCopy(CREATOR_INVITE_SEED_COPY.en, {
      email: 'sam@example.com', name: 'Sam', link: 'https://auth.example/invite/t', expiresAt: at, note: 'Hi', locale: 'en',
      channels: [{ name: 'One', action: 'created' }, { name: 'Two', action: 'created' }, { name: 'Old', action: 'transferred' }],
    });
    assert.equal(doc.subject, "You're invited to Al Ummah Now");
    assert.equal(doc.preheader, 'Your creator account and One, Two, and Old are ready. Accept the invite to sign in.');
    assert.equal(doc.greeting, 'Assalamu alaikum Sam,');
    assert.deepEqual(doc.blocks[0], { kind: 'p', text: 'An Al Ummah Now admin has set up a creator account for you. It comes with the channels One and Two, ready for you to manage. The channel Old has been moved to your account.' });
    assert.equal(doc.cta?.label, 'Accept the invite');
    assert.deepEqual(doc.after?.[0], { kind: 'quote', label: 'Note from the admin', text: 'Hi' });
    assert.equal((doc.blocks[1] as { text: string }).text, "Accept the invite to sign in as sam@example.com. You don't need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.");
    assert.equal((doc.after?.[1] as { text: string }).text, 'This link works once, until 30 November 2026. If it has expired or was already used, open it anyway and ask for a new one.');
  });

  it('writes Arabic right to left with ٠–٩ in the expiry date', () => {
    const r = renderInviteFromCopy(CREATOR_INVITE_SEED_COPY.ar, { email: 'a@example.com', name: null, link: 'https://x.example/i', expiresAt: Date.UTC(2026, 10, 30), note: null, locale: 'ar' });
    assert.match(r.html, /dir="rtl"/);
    assert.match(r.text, /السلام عليكم،/);
    assert.match(r.text, /٣٠/);
    assert.doesNotMatch(r.text, /\b30\b/);
  });
});

/** The sign-in sentences as migration 0036 seeded them (before AlUmmahNowAuth #434). */
const V1 = {
  en: {
    how: 'Sign in with {email}. If you have not set a password yet, choose "Create account" and we will email you a code to confirm it is you.',
    expires: 'This link works until {expires}. After that you can still sign in with this email address.',
  },
  ar: {
    how: 'سجّل الدخول باستخدام {email}. إن لم تكن قد عيّنت كلمة مرور بعد، فاختر «إنشاء حساب» وسنرسل إليك رمزًا للتأكد من أنك صاحب البريد.',
    expires: 'يعمل هذا الرابط حتى {expires}. وبعد ذلك يمكنك تسجيل الدخول بهذا البريد الإلكتروني.',
  },
} as const;

describe('migration 0045: the sign-in wording for the one-time link', () => {
  const read = async (db: D1Database) => {
    const t = await db.prepare('SELECT version, content, updated_by FROM email_templates WHERE key = ?').bind('creator_invite').first<{ version: number; content: string; updated_by: string }>();
    const { results } = await db.prepare('SELECT version, action, source_version, content, created_by FROM email_template_versions WHERE key = ? ORDER BY version').bind('creator_invite').all<{ version: number; action: string; source_version: number | null; content: string; created_by: string }>();
    return { t: t!, content: JSON.parse(t!.content) as EmailTemplateContent, versions: results };
  };

  it('moves the untouched seed to the default copy as a new version in History, restorable like any other', async () => {
    const { t, content, versions } = await read(sqliteD1());
    assert.deepEqual(content, seedContent());
    assert.equal(t.updated_by, 'system');
    assert.deepEqual(versions.map((v) => [v.version, v.action, v.source_version, v.created_by]), [[1, 'seed', null, 'system'], [2, 'update', 1, 'system']]);
    assert.deepEqual(JSON.parse(versions[1]!.content), content);
    assert.equal(JSON.parse(versions[0]!.content).copy.en.how, V1.en.how);
  });

  it("keeps an admin's own wording: only the sentences still equal to the seed change", async () => {
    const db = sqliteD1(undefined, (file, sql) => {
      if (file !== '0045_invite_wording_link_flow.sql') return;
      // An admin saved version 2 before this migration: their own English "how" and Arabic button
      sql(`UPDATE email_templates SET version = 2, updated_by = 'admin-7', content = json_set(content, '$.copy.en.how', 'Welcome! Sign in as {email}.', '$.copy.ar.button', 'اقبل دعوتك') WHERE key = 'creator_invite'`);
      sql(`INSERT INTO email_template_versions (key, version, content, action, source_version, created_at, created_by) SELECT key, 2, content, 'save', NULL, updated_at, 'admin-7' FROM email_templates WHERE key = 'creator_invite'`);
    });
    const { t, content, versions } = await read(db);
    assert.equal(t.version, 3);
    assert.equal(content.copy.en.how, 'Welcome! Sign in as {email}.');
    assert.equal(content.copy.ar.button, 'اقبل دعوتك');
    assert.equal(content.copy.en.expires, CREATOR_INVITE_SEED_COPY.en.expires);
    assert.equal(content.copy.ar.how, CREATOR_INVITE_SEED_COPY.ar.how);
    assert.equal(content.copy.ar.expires, CREATOR_INVITE_SEED_COPY.ar.expires);
    assert.deepEqual(versions.map((v) => [v.version, v.action, v.source_version]), [[1, 'seed', null], [2, 'save', null], [3, 'update', 2]]);
    assert.deepEqual(checkEmailTemplate(CREATOR_INVITE_TEMPLATE, content), []);
  });

  it('changes nothing (no new version) when an admin already rewrote all four sentences', async () => {
    const db = sqliteD1(undefined, (file, sql) => {
      if (file !== '0045_invite_wording_link_flow.sql') return;
      sql(`UPDATE email_templates SET version = 2, content = json_set(content, '$.copy.en.how', 'A {email}', '$.copy.en.expires', 'B {expires}', '$.copy.ar.how', 'ج {email}', '$.copy.ar.expires', 'د {expires}') WHERE key = 'creator_invite'`);
    });
    const { t, content, versions } = await read(db);
    assert.equal(t.version, 2);
    assert.deepEqual([content.copy.en.how, content.copy.en.expires, content.copy.ar.how, content.copy.ar.expires], ['A {email}', 'B {expires}', 'ج {email}', 'د {expires}']);
    assert.deepEqual(versions.map((v) => v.action), ['seed']);
  });

  it('runs twice without a second version (idempotent)', async () => {
    const files = readdirSync(join(process.cwd(), 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    const { versions } = await read(sqliteD1([...files, '0045_invite_wording_link_flow.sql']));
    assert.deepEqual(versions.map((v) => v.action), ['seed', 'update']);
  });

  it('says what the link really does, with no digits typed into the Arabic and «مرئي» for video', () => {
    for (const lang of ['en', 'ar'] as const) {
      const c = CREATOR_INVITE_SEED_COPY[lang];
      assert.notEqual(c.how, V1[lang].how);
      assert.notEqual(c.expires, V1[lang].expires);
      for (const text of Object.values(c)) assert.doesNotMatch(text, /[0-9٠-٩]/);
    }
    assert.match(CREATOR_INVITE_SEED_COPY.en.expires, /works once/);
    assert.match(CREATOR_INVITE_SEED_COPY.ar.expires, /مرة واحدة/);
    assert.match(CREATOR_INVITE_SEED_COPY.ar.videoIntro, /المرئي/);
    assert.doesNotMatch(Object.values(CREATOR_INVITE_SEED_COPY.ar).join(' '), /فيديو|درس|دروس|محاضر/);
    assert.doesNotMatch(Object.values(CREATOR_INVITE_SEED_COPY.en).join(' '), /lesson|lecture|course|learn/i);
  });
});

describe('placeholder checks', () => {
  const field = (id: string) => CREATOR_INVITE_TEMPLATE.fields.find((f) => f.id === id)!;
  it('refuses unknown, not-allowed and missing placeholders, stray braces and empty text', () => {
    assert.deepEqual(checkEmailField(field('greeting'), 'en', 'Hi {nmae},').map((i) => i.code).sort(), ['placeholder_missing', 'unknown_placeholder']);
    assert.deepEqual(checkEmailField(field('button'), 'en', 'Go {email}').map((i) => i.code), ['placeholder_not_allowed']);
    assert.deepEqual(checkEmailField(field('expires'), 'ar', 'حتى {expires'), [{ field: 'expires', lang: 'ar', code: 'placeholder_missing', placeholder: 'expires' }, { field: 'expires', lang: 'ar', code: 'stray_brace' }]);
    assert.deepEqual(checkEmailField(field('reason'), 'ar', '   ').map((i) => i.code), ['required']);
    assert.deepEqual(checkEmailField(field('button'), 'en', 'x'.repeat(41)).map((i) => i.code), ['too_long']);
  });
  it('fills in one pass, so a name that looks like a placeholder stays as typed', () => {
    assert.equal(fillPlaceholders('Hi {name}, {email}', { name: '{email}', email: 'a@b.c' }), 'Hi {email}, a@b.c');
  });
});

describe('saving, history, restore and undo', () => {
  it('saves a new version, keeps the old one, and refuses a stale editor', async () => {
    const { api } = setup();
    const content = seedContent();
    content.copy.en.button = 'Join now';
    const saved = await api('PUT', '/creator_invite', { baseVersion: 2, content });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.result.version, 3);
    assert.equal(saved.json.result.updatedBy, 'admin-1');
    const stale = await api('PUT', '/creator_invite', { baseVersion: 2, content });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.current, 3);
    const history = await api('GET', '/creator_invite/versions');
    assert.deepEqual(history.json.result.items.map((v: { version: number; action: string }) => [v.version, v.action]), [[3, 'save'], [2, 'update'], [1, 'seed']]);
  });

  it('refuses an invalid template with every issue, and saves nothing', async () => {
    const { api } = setup();
    const content = seedContent();
    content.copy.ar.greeting = 'السلام عليكم،';
    content.copy.en.subject = '';
    const r = await api('PUT', '/creator_invite', { baseVersion: 2, content });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'invalid_template');
    assert.deepEqual((r.json as any).issues.map((i: { field: string; lang: string; code: string }) => `${i.lang}.${i.field}.${i.code}`).sort(), ['ar.greeting.placeholder_missing', 'en.subject.required']);
    assert.equal((await api('GET', '/creator_invite')).json.result.version, 2);
  });

  it('restores an earlier version and undoes a save as new versions', async () => {
    const { api } = setup();
    const content = seedContent();
    content.copy.en.button = 'Join now';
    await api('PUT', '/creator_invite', { baseVersion: 2, content });
    const undo = await api('POST', '/creator_invite/restore', { version: 2, baseVersion: 3, undo: true });
    assert.equal(undo.json.result.version, 4);
    assert.equal(undo.json.result.content.copy.en.button, 'Accept the invite');
    const restore = await api('POST', '/creator_invite/restore', { version: 3, baseVersion: 4 });
    assert.equal(restore.json.result.content.copy.en.button, 'Join now');
    const history = await api('GET', '/creator_invite/versions');
    assert.deepEqual(history.json.result.items.map((v: { action: string; sourceVersion: number | null }) => [v.action, v.sourceVersion]), [['restore', 3], ['undo', 2], ['save', null], ['update', 1], ['seed', null]]);
  });

  it('keeps default videos only when they are public', async () => {
    const { api, db } = setup();
    videos = [{ id: 'vid_pub', isPublic: true, isHidden: false, isDeleted: false }, { id: 'vid_priv', isPublic: false, isHidden: false, isDeleted: false }];
    const content = seedContent();
    content.defaultVideos = { en: 'vid_pub', ar: 'vid_priv' };
    const refused = await api('PUT', '/creator_invite', { baseVersion: 2, content });
    assert.equal(refused.status, 400);
    assert.deepEqual((refused.json as any).issues, [{ field: 'defaultVideo', lang: 'ar', code: 'invalid_video' }]);
    content.defaultVideos = { en: 'vid_pub', ar: null };
    assert.equal((await api('PUT', '/creator_invite', { baseVersion: 2, content })).status, 200);
    assert.equal(await getInviteDefaultVideoId(db, 'en'), 'vid_pub');
    assert.equal(await getInviteDefaultVideoId(db, 'ar'), null);
  });

  it('writes an audit row for each change', async () => {
    const { api, db } = setup();
    await api('PUT', '/creator_invite', { baseVersion: 2, content: seedContent() });
    await api('POST', '/creator_invite/restore', { version: 2, baseVersion: 3, undo: true });
    const { results } = await db.prepare("SELECT action, target_id FROM admin_audit_log WHERE target_type = 'email_template' ORDER BY created_at").all<{ action: string; target_id: string }>();
    assert.deepEqual(results.map((r) => r.action), ['email_template.saved', 'email_template.undone']);
  });
});

describe('who may open it', () => {
  it('is Super Admin and Admin only', async () => {
    assert.equal((await setup(['moderator']).api('GET', '/creator_invite')).status, 403);
    assert.equal((await setup(['super_admin']).api('GET', '/creator_invite')).status, 200);
  });
});

describe('preview and test send', () => {
  it('previews unsaved copy with sample data and lists that language’s issues', async () => {
    const { api } = setup();
    const content = seedContent();
    content.copy.ar.button = 'انضم الآن';
    content.copy.en.expires = 'Until soon';
    const ar = await api('POST', '/creator_invite/preview', { content, locale: 'ar', sample: { channels: 'many' } });
    assert.match(ar.json.result.html, /انضم الآن/);
    assert.match(ar.json.result.text, /عائشة الرحمن/);
    assert.deepEqual(ar.json.result.issues, []);
    const en = await api('POST', '/creator_invite/preview', { content, locale: 'en' });
    assert.deepEqual(en.json.result.issues.map((i: { code: string }) => i.code), ['placeholder_missing']);
  });

  it('emails the signed-in admin a marked test, rate limited per hour', async () => {
    const { api } = setup();
    const first = await api('POST', '/creator_invite/test', { content: seedContent(), locale: 'ar' });
    assert.equal(first.status, 200);
    assert.deepEqual(mails[0]!.to, ['admin@example.org']);
    assert.match(String(mails[0]!.subject), /^\[تجربة\] /);
    assert.match(String(mails[0]!.text), /هذه رسالة تجريبية/);
    for (let i = 1; i < EMAIL_TEST_SENDS_PER_HOUR; i++) assert.equal((await api('POST', '/creator_invite/test', { content: seedContent(), locale: 'en' })).status, 200);
    const limited = await api('POST', '/creator_invite/test', { content: seedContent(), locale: 'en' });
    assert.equal(limited.status, 429);
    assert.equal(mails.length, EMAIL_TEST_SENDS_PER_HOUR);
  });

  it('refuses a test without an admin address or with broken copy', async () => {
    assert.equal((await setup(['admin'], null).api('POST', '/creator_invite/test', { content: seedContent(), locale: 'en' })).json.code, 'no_email');
    const content = seedContent();
    content.copy.en.greeting = 'Hello';
    assert.equal((await setup().api('POST', '/creator_invite/test', { content, locale: 'en' })).json.code, 'invalid_template');
  });

  it('samples a made-up person, never a real one', () => {
    const s = sampleInvite('en', { link: 'https://x', channels: 'transferred' });
    assert.equal(s.email, 'creator@example.com');
    assert.deepEqual(s.channels, [{ name: 'Friday Khutbahs', action: 'transferred' }]);
  });
});

describe('the copy an invite carries', () => {
  it('is the current version in the invite’s language', async () => {
    const { api, db } = setup();
    const content = seedContent();
    content.copy.ar.button = 'انضم الآن';
    await api('PUT', '/creator_invite', { baseVersion: 2, content });
    assert.deepEqual(await resolveEmailCopy(db, 'creator_invite', 'ar'), { key: 'creator_invite', version: 3, locale: 'ar', copy: content.copy.ar });
    assert.equal((await resolveEmailCopy(db, 'creator_invite', 'fr'))?.locale, 'en');
  });

  it('is null (Auth uses its built-in copy) when the template is missing', async () => {
    const db = sqliteD1();
    await db.prepare("DELETE FROM email_templates WHERE key = 'creator_invite'").run();
    assert.equal(await resolveEmailCopy(db, 'creator_invite', 'en'), null);
  });
});
