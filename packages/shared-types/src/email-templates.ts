/**
 * Admin-editable system emails (videos admin › Settings › Emails; wiki "Email templates").
 *
 * One model for every system email the platform sends: a template has a key, a list of copy
 * fields, each written in English AND Arabic (both required, no fallback), and the placeholders
 * each field may use. admin-api stores the template with every saved version
 * (migration 0036: email_templates + email_template_versions); the copy for the email's one
 * language travels with the send request, already resolved, so the sender never reads the admin
 * DB. Only the creator invite is editable today; the other system emails are listed in the
 * tracking issue linked from the wiki page.
 *
 * Placeholders are `{name}`-style tokens. A field may only use the placeholders its definition
 * allows, must keep the ones it requires, and a stray brace is refused (machine translation
 * sometimes mangles them), so a saved template always renders.
 */

export const EMAIL_TEMPLATE_LANGS = ['en', 'ar'] as const;
export type EmailTemplateLang = (typeof EMAIL_TEMPLATE_LANGS)[number];

export const EMAIL_TEMPLATE_KEYS = ['creator_invite'] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const isEmailTemplateKey = (key: string): key is EmailTemplateKey => (EMAIL_TEMPLATE_KEYS as readonly string[]).includes(key);

/** Every placeholder any template may use; each field narrows it. */
export const EMAIL_PLACEHOLDERS = ['name', 'email', 'channels', 'expires', 'title'] as const;
export type EmailPlaceholder = (typeof EMAIL_PLACEHOLDERS)[number];

export interface EmailTemplateFieldDef {
  id: string;
  /** Section of the editor the field belongs to */
  group: string;
  multiline: boolean;
  maxLength: number;
  /** Placeholders the field may use */
  allowed: readonly EmailPlaceholder[];
  /** Placeholders the field must keep (the sentence makes no sense without them) */
  required: readonly EmailPlaceholder[];
}

export interface EmailTemplateDef {
  key: EmailTemplateKey;
  fields: readonly EmailTemplateFieldDef[];
  /** The template also has a default video per language (the invite's video card) */
  defaultVideos: boolean;
}

const f = (id: string, group: string, opts: Partial<Omit<EmailTemplateFieldDef, 'id' | 'group'>> = {}): EmailTemplateFieldDef => ({
  id,
  group,
  multiline: opts.multiline ?? false,
  maxLength: opts.maxLength ?? 600,
  allowed: opts.allowed ?? [],
  required: opts.required ?? [],
});

export const CREATOR_INVITE_TEMPLATE: EmailTemplateDef = {
  key: 'creator_invite',
  defaultVideos: true,
  fields: [
    f('subject', 'subject', { maxLength: 150, allowed: ['name'] }),
    f('preheader', 'subject', { maxLength: 200, allowed: ['name'] }),
    f('preheaderChannels', 'subject', { maxLength: 200, allowed: ['name', 'channels'], required: ['channels'] }),
    f('greeting', 'greeting', { maxLength: 150, allowed: ['name'], required: ['name'] }),
    f('greetingNoName', 'greeting', { maxLength: 150 }),
    f('account', 'account', { multiline: true, allowed: ['name', 'email'] }),
    f('createdOne', 'account', { multiline: true, allowed: ['channels'], required: ['channels'] }),
    f('createdMany', 'account', { multiline: true, allowed: ['channels'], required: ['channels'] }),
    f('transferredOne', 'account', { multiline: true, allowed: ['channels'], required: ['channels'] }),
    f('transferredMany', 'account', { multiline: true, allowed: ['channels'], required: ['channels'] }),
    f('how', 'signIn', { multiline: true, allowed: ['name', 'email'] }),
    f('button', 'button', { maxLength: 40 }),
    // The invite's video card (shown only when the invite has a video in its language)
    f('videoIntro', 'video', { maxLength: 200, allowed: ['name'] }),
    f('videoAlt', 'video', { maxLength: 200, allowed: ['title'], required: ['title'] }),
    f('noteLabel', 'button', { maxLength: 60 }),
    f('expires', 'expiry', { multiline: true, allowed: ['expires', 'email'], required: ['expires'] }),
    f('reason', 'footer', { multiline: true, allowed: ['email'] }),
  ],
};

export const EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateDef> = { creator_invite: CREATOR_INVITE_TEMPLATE };

export type EmailCopy = Record<string, string>;

/** What admin-api stores per version. */
export interface EmailTemplateContent {
  copy: Record<EmailTemplateLang, EmailCopy>;
  /** Templates with `defaultVideos`: a public video id per language, or null */
  defaultVideos?: Record<EmailTemplateLang, string | null>;
}

/** The copy that travels with a send request: one language, already chosen. */
export interface ResolvedEmailCopy {
  key: EmailTemplateKey;
  version: number;
  locale: EmailTemplateLang;
  copy: EmailCopy;
}

/** seed: the first version (migration 0036); update: a wording fix shipped by a migration (by 'system'). */
export type EmailTemplateVersionAction = 'seed' | 'save' | 'restore' | 'undo' | 'update';

export interface EmailTemplateState {
  key: EmailTemplateKey;
  version: number;
  content: EmailTemplateContent;
  updatedAt: string;
  updatedBy: string;
}

export interface EmailTemplateVersion {
  version: number;
  action: EmailTemplateVersionAction;
  /** restore/undo: the version that was brought back */
  sourceVersion: number | null;
  content: EmailTemplateContent;
  createdAt: string;
  createdBy: string;
}

export type EmailTemplateIssueCode = 'required' | 'too_long' | 'unknown_placeholder' | 'placeholder_not_allowed' | 'placeholder_missing' | 'stray_brace' | 'invalid_video';

export interface EmailTemplateIssue {
  field: string;
  lang: EmailTemplateLang;
  code: EmailTemplateIssueCode;
  placeholder?: string;
  max?: number;
}

/**
 * The creator invite's default copy: version 1 (migration 0036, the words Auth sent before the copy was
 * editable) with the sign-in sentences (how, expires) updated by migration 0045 for the one-time link that
 * signs the person in (AlUmmahNowAuth #434). The same words as Auth's built-in copy.
 */
export const CREATOR_INVITE_SEED_COPY: Record<EmailTemplateLang, EmailCopy> = {
  en: {
    subject: "You're invited to Al Ummah Now",
    preheader: 'Your creator account is ready. Accept the invite to sign in.',
    preheaderChannels: 'Your creator account and {channels} are ready. Accept the invite to sign in.',
    greeting: 'Assalamu alaikum {name},',
    greetingNoName: 'Assalamu alaikum,',
    account: 'An Al Ummah Now admin has set up a creator account for you.',
    createdOne: 'It comes with the channel {channels}, ready for you to manage.',
    createdMany: 'It comes with the channels {channels}, ready for you to manage.',
    transferredOne: 'The channel {channels} has been moved to your account.',
    transferredMany: 'The channels {channels} have been moved to your account.',
    how: "Accept the invite to sign in as {email}. You don't need a password: the button signs you in, and you can add a passkey (Face ID or fingerprint) right after.",
    button: 'Accept the invite',
    videoIntro: 'They also shared this video with you:',
    videoAlt: 'Play "{title}" on Al Ummah Now',
    noteLabel: 'Note from the admin',
    expires: 'This link works once, until {expires}. If it has expired or was already used, open it anyway and ask for a new one.',
    reason: "You got this email because an Al Ummah Now admin invited this address to a creator account. If you weren't expecting it, you can ignore it.",
  },
  ar: {
    subject: 'دعوة للانضمام إلى الأمة الآن',
    preheader: 'حساب صانع المحتوى الخاص بك جاهز. اقبل الدعوة لتسجيل الدخول.',
    preheaderChannels: 'حساب صانع المحتوى الخاص بك جاهز مع {channels}. اقبل الدعوة لتسجيل الدخول.',
    greeting: 'السلام عليكم {name}،',
    greetingNoName: 'السلام عليكم،',
    account: 'أنشأ لك أحد مشرفي الأمة الآن حساب صانع محتوى.',
    createdOne: 'ويضم القناة {channels} جاهزةً لتديرها.',
    createdMany: 'ويضم القنوات {channels} جاهزةً لتديرها.',
    transferredOne: 'ونُقلت إليه القناة {channels}.',
    transferredMany: 'ونُقلت إليه القنوات {channels}.',
    how: 'اقبل الدعوة لتسجيل الدخول باسم {email}. لا تحتاج إلى كلمة مرور: يسجّل الزر دخولك، ويمكنك بعدها مباشرة إضافة مفتاح مرور (بصمة الوجه أو الإصبع).',
    button: 'قبول الدعوة',
    videoIntro: 'وشارك معك هذا المرئي:',
    videoAlt: 'شغّل «{title}» على الأمة الآن',
    noteLabel: 'ملاحظة من المشرف',
    expires: 'يعمل هذا الرابط مرة واحدة حتى {expires}. إن انتهت صلاحيته أو استُخدم من قبل، فافتحه واطلب رابطًا جديدًا.',
    reason: 'وصلتك هذه الرسالة لأن أحد مشرفي الأمة الآن دعا هذا العنوان إلى حساب صانع محتوى. إن لم تكن تتوقعها، فيمكنك تجاهلها.',
  },
};

const TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The placeholder names a text uses, in order (repeats kept). */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]!);
}

/** Problems with one field's text, in one language. */
export function checkEmailField(def: EmailTemplateFieldDef, lang: EmailTemplateLang, value: unknown): EmailTemplateIssue[] {
  const text = typeof value === 'string' ? value : '';
  if (!text.trim()) return [{ field: def.id, lang, code: 'required' }];
  const issues: EmailTemplateIssue[] = [];
  if (text.length > def.maxLength) issues.push({ field: def.id, lang, code: 'too_long', max: def.maxLength });
  const used = placeholdersIn(text);
  for (const name of new Set(used)) {
    if (!(EMAIL_PLACEHOLDERS as readonly string[]).includes(name)) issues.push({ field: def.id, lang, code: 'unknown_placeholder', placeholder: name });
    else if (!def.allowed.includes(name as EmailPlaceholder)) issues.push({ field: def.id, lang, code: 'placeholder_not_allowed', placeholder: name });
  }
  for (const name of def.required) if (!used.includes(name)) issues.push({ field: def.id, lang, code: 'placeholder_missing', placeholder: name });
  if (/[{}]/.test(text.replace(TOKEN, ''))) issues.push({ field: def.id, lang, code: 'stray_brace' });
  return issues;
}

/** Every problem with a template's content; empty when it may be saved. */
export function checkEmailTemplate(def: EmailTemplateDef, content: unknown): EmailTemplateIssue[] {
  const c = (content && typeof content === 'object' ? content : {}) as Partial<EmailTemplateContent>;
  const issues: EmailTemplateIssue[] = [];
  for (const lang of EMAIL_TEMPLATE_LANGS) {
    const copy = (c.copy?.[lang] ?? {}) as EmailCopy;
    for (const field of def.fields) issues.push(...checkEmailField(field, lang, copy[field.id]));
  }
  if (def.defaultVideos) {
    for (const lang of EMAIL_TEMPLATE_LANGS) {
      const v = c.defaultVideos?.[lang];
      if (v !== null && v !== undefined && (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v))) issues.push({ field: 'defaultVideo', lang, code: 'invalid_video' });
    }
  }
  return issues;
}

/** The content cut down to the template's own fields (unknown keys dropped, text trimmed at the ends). */
export function cleanEmailTemplate(def: EmailTemplateDef, content: EmailTemplateContent): EmailTemplateContent {
  const copy = {} as Record<EmailTemplateLang, EmailCopy>;
  for (const lang of EMAIL_TEMPLATE_LANGS) {
    copy[lang] = {};
    for (const field of def.fields) copy[lang][field.id] = String(content.copy?.[lang]?.[field.id] ?? '').trim();
  }
  const out: EmailTemplateContent = { copy };
  if (def.defaultVideos) out.defaultVideos = { en: content.defaultVideos?.en || null, ar: content.defaultVideos?.ar || null };
  return out;
}

/** Fills the placeholders in one pass (a value that itself looks like `{x}` is never filled again). */
export function fillPlaceholders(text: string, values: Partial<Record<EmailPlaceholder, string>>): string {
  return text.replace(TOKEN, (whole, name: string) => {
    const v = values[name as EmailPlaceholder];
    return v === undefined ? whole : v;
  });
}

/** "Send test to me": test emails each admin may send an hour, across all templates. */
export const EMAIL_TEST_SENDS_PER_HOUR = 5;
