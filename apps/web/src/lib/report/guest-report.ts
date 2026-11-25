/**
 * Content report page helpers (/[locale]/report).
 *
 * The page takes what is reported from its query (Android #70, Apple #99: ?type=video|channel|livestream
 * (or live)|live_chat|comment|post, id, stream, message), or a pasted link or id. Signed out it sends
 * POST /api/report; signed in it files a report as the report buttons do (lib/api/moderation.ts).
 */

import { csamUrlPart, parseCsamUrl } from '@al-ummah/shared-types';
import type { ReportReason } from '@/lib/api/moderation';

export const GUEST_REPORT_TYPES = ['video', 'channel', 'livestream', 'live_chat', 'comment', 'post'] as const;
export type GuestReportType = (typeof GUEST_REPORT_TYPES)[number];

/** Child safety is always first for visibility and priority routing. */
export const GUEST_REPORT_REASONS = [
  'child_safety',
  'harassment',
  'spam',
  'violence',
  'copyright',
  'other',
] as const;
export type GuestReportReason = (typeof GUEST_REPORT_REASONS)[number];

/** The report reason each of the page's reasons is filed as by a signed-in person (as admin-api does for guests). */
export const REPORT_REASON_OF: Record<GuestReportReason, ReportReason> = {
  child_safety: 'child_safety',
  harassment: 'harassment',
  spam: 'spam',
  violence: 'inappropriate',
  copyright: 'copyright',
  other: 'other',
};

export interface GuestReportTarget {
  /** Validated type when recognized from query params; null when missing or unknown. */
  type: GuestReportType | null;
  id: string;
  stream: string;
  message: string;
  /** True when a non-empty ?type= query param was provided but not recognized. */
  unknownType: boolean;
}

export interface ResolvedReportTargetInput {
  entityType: GuestReportType;
  entityId: string;
  entityParentId?: string;
}

export type ManualTargetResolution =
  | ({ ok: true; fromUrl: boolean } & ResolvedReportTargetInput)
  | { ok: false; error: 'required' | 'unsupportedUrl' | 'invalidId' };

const MAX_ID_LEN = 160;
const BARE_OUR_HOST_RE = /^(?:[a-z0-9-]+\.)*alummahnow\.(?:net|com|org|link)(?:\/|$)/i;
/** Ids of ours, and a channel's @handle (as POST /internal/guest-reports accepts them) */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HANDLE_RE = /^@[A-Za-z0-9](?:[A-Za-z0-9._-]{1,28})[A-Za-z0-9]$/;

function cleanParam(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[\r\n\t\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, MAX_ID_LEN);
}

function decodeSegment(seg: string): string {
  try {
    return cleanParam(decodeURIComponent(seg));
  } catch {
    return '';
  }
}

export function parseGuestReportParams(params: Pick<URLSearchParams, 'get'> | null | undefined): GuestReportTarget {
  const rawType = cleanParam(params?.get('type')).toLowerCase();
  const normalized = rawType === 'live' ? 'livestream' : rawType;
  const isKnown = (GUEST_REPORT_TYPES as readonly string[]).includes(normalized);
  return {
    type: isKnown ? (normalized as GuestReportType) : null,
    id: cleanParam(params?.get('id')),
    stream: cleanParam(params?.get('stream')),
    message: cleanParam(params?.get('message')),
    unknownType: Boolean(rawType && !isKnown),
  };
}

export function hasGuestReportTarget(target: GuestReportTarget): boolean {
  if (!target.type) return false;
  if (target.type === 'live_chat') return Boolean(target.message || target.id || target.stream);
  return Boolean(target.id);
}

/**
 * What a pasted link or reference ID is about. Links are read by the trust and safety intake's own parser
 * (parseCsamUrl): only whole paths of ours, a comment's link is the comment and never what it is on, and a link
 * that names no single item is an error on the field, never sent on as an id.
 */
export function resolveManualReportTarget(selectedType: GuestReportType, rawInput: string): ManualTargetResolution {
  const cleaned = cleanParam(rawInput);
  if (!cleaned) return { ok: false, error: 'required' };
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned);
  if (!scheme && !BARE_OUR_HOST_RE.test(cleaned)) return validTarget({ ok: true, fromUrl: false, entityType: selectedType, entityId: cleaned });
  const found = targetOfUrl(scheme ? cleaned : `https://${cleaned}`);
  return found ? validTarget({ ok: true, fromUrl: true, ...found }) : { ok: false, error: 'unsupportedUrl' };
}

function targetOfUrl(input: string): ResolvedReportTargetInput | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const target = parseCsamUrl(url);
  switch (target?.kind) {
    case 'page':
      if (target.page === 'post') return { entityType: 'post', entityId: target.postId, ...(target.id ? { entityParentId: target.id } : {}) };
      return { entityType: target.page === 'channel' ? 'channel' : 'video', entityId: target.id };
    case 'video_thumbnail':
      return { entityType: 'video', entityId: target.videoId };
    case 'live_stream':
      return { entityType: 'livestream', entityId: target.streamId };
    case 'comment':
      return { entityType: 'comment', entityId: target.commentId, entityParentId: target.parentId };
    case 'site':
      // Another domain may be a scholar's, but only the server could tell
      if (!target.ours || !target.item || !target.id) return null;
      return target.commentId ? { entityType: 'comment', entityId: target.commentId, entityParentId: target.id } : { entityType: target.item, entityId: target.id };
    case 'other':
      return handleOf(url);
    default:
      return null;
  }
}

/** A channel's page by its handle (/@name, /c/name), which names several items and so nothing to the intake. */
function handleOf(url: URL): ResolvedReportTargetInput | null {
  if (url.search.length > 1 && [...url.searchParams.keys()].some((key) => !['lang', 'tab', 'sort'].includes(key) && !key.startsWith('utm_'))) return null;
  if (csamUrlPart(url)) return null;
  const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment);
  const p = /^(?:en|ar)$/i.test(parts[0] ?? '') ? parts.slice(1) : parts;
  if (p.length === 1 && p[0].startsWith('@')) return { entityType: 'channel', entityId: p[0] };
  if (p.length === 2 && p[0].toLowerCase() === 'c') return { entityType: 'channel', entityId: p[1].startsWith('@') ? p[1] : `@${p[1]}` };
  return null;
}

/** A target the server would refuse as malformed is an error on the field. */
function validTarget(target: Extract<ManualTargetResolution, { ok: true }>): ManualTargetResolution {
  const { entityType, entityId } = target;
  return ID_RE.test(entityId) || (entityType === 'channel' && HANDLE_RE.test(entityId)) ? target : { ok: false, error: 'invalidId' };
}

/** Resolves the canonical entity fields sent to POST /api/report. */
export function resolveReportSubmissionTarget(
  prefilled: GuestReportTarget,
  manualType: GuestReportType,
  manualInput: string,
): ManualTargetResolution {
  if (hasGuestReportTarget(prefilled) && prefilled.type) {
    if (prefilled.type === 'live_chat') {
      const message = prefilled.message || prefilled.id;
      // Only the stream is named: it is the stream that is reported
      if (!message) return validTarget({ ok: true, fromUrl: false, entityType: 'livestream', entityId: prefilled.stream });
      return validTarget({ ok: true, fromUrl: false, entityType: 'live_chat', entityId: message, ...(prefilled.stream ? { entityParentId: prefilled.stream } : {}) });
    }
    return validTarget({ ok: true, fromUrl: false, entityType: prefilled.type, entityId: prefilled.id });
  }
  return resolveManualReportTarget(manualType, manualInput);
}

export const GUEST_REPORT_COPY = {
  en: {
    title: 'Report content',
    lead: 'Tell our moderation team about a video, channel, live stream, live chat message, comment or post. You do not need an account.',
    formLabel: 'Content report form',
    targetHeading: 'Reported item',
    unknownTypeNotice: 'The content type in this link was not recognized. Choose the content type below and paste the Al Ummah Now link or reference ID.',
    resolvedTargetLabel: 'From your link',
    manualTypeLabel: 'What are you reporting?',
    manualTargetLabel: 'Link or reference ID',
    manualTargetPlaceholder: 'Paste a link or reference ID',
    manualTargetHint: 'An Al Ummah Now link to a video, channel, live stream, post or comment, or its reference ID.',
    types: {
      video: 'Video',
      channel: 'Channel',
      livestream: 'Live stream',
      live_chat: 'Live chat message',
      comment: 'Comment',
      post: 'Post',
    } as Record<GuestReportType, string>,
    targetIdLabel: 'Reference ID',
    streamIdLabel: 'Stream ID',
    messageIdLabel: 'Message ID',
    reasonLabel: 'Why are you reporting this?',
    priorityTag: 'Reviewed first',
    reasons: {
      child_safety: { label: 'Child safety concern', hint: 'A child may be at risk, harmed or exploited.' },
      harassment: { label: 'Hate speech or harassment', hint: 'Slurs, threats, bullying, or incitement to hatred.' },
      spam: { label: 'Spam, scam, or misleading', hint: 'Scams, impersonation, or deceptive content.' },
      violence: { label: 'Violence or dangerous content', hint: 'Graphic violence, self-harm, or illegal acts.' },
      copyright: { label: 'Copyright', hint: 'Content posted without its owner’s permission.' },
      other: { label: 'Something else', hint: 'Another problem with our Community Guidelines.' },
    } as Record<GuestReportReason, { label: string; hint: string }>,
    detailsLabel: 'Details (optional)',
    detailsHint: 'For example the time in the video, or what is wrong. Please do not include your own contact details.',
    signedInTitle: 'Signed-in report',
    signedInBody: 'Your report is linked to your account, and moderators can see who sent it.',
    privacyTitle: 'What we keep',
    privacyBody: 'Only the report: what you are reporting, the reason and your details. Your name, email and address are not stored with it. To limit abuse we count reports per network under a scrambled code that is deleted within two days.',
    honeypotLabel: 'Website',
    submit: 'Submit report',
    sending: 'Submitting report…',
    errors: {
      summary: 'Please fix the following before submitting:',
      targetRequired: 'Enter an Al Ummah Now link or reference ID for what you are reporting.',
      unsupportedUrl: 'That link does not open one video, channel, live stream, post or comment on Al Ummah Now. Paste its own link, or its reference ID.',
      invalidId: 'That is not a valid reference ID. Paste the link instead.',
      reasonRequired: 'Select a reason for this report.',
      detailsTooLong: 'Details must be {max} characters or fewer.',
      rateLimited: 'We cannot take another report here right now. Try again later, or write to us:',
      contactLink: 'Contact us',
      duplicate: 'You have already reported this.',
      signIn: 'Your session has ended. Sign in again, or sign out to report without an account.',
      unavailable: 'Reports cannot be sent right now. Please try again shortly.',
      network: 'We could not reach the server. Check your connection and try again.',
      generic: 'We could not send your report. Please try again.',
    },
    success: {
      title: 'Report sent',
      body: 'Thank you. Our moderation team will review it.',
      another: 'Report something else',
      home: 'Back to Al Ummah Now',
    },
    aside: {
      title: 'What happens next',
      review: 'Reports are reviewed by our moderation team and may take 24-48 hours to process. Child safety reports are reviewed first.',
      danger: 'If a child is in danger now, contact your local emergency services.',
      guidelines: 'Read our Community Guidelines',
      privacy: 'Read our Privacy Policy',
    },
    counter: '{count} / {max}',
  },
  ar: {
    title: 'الإبلاغ عن محتوى',
    lead: 'أخبر فريق الإشراف عن مرئي أو قناة أو بث مباشر أو رسالة في محادثة بث أو تعليق أو منشور. لا تحتاج إلى حساب.',
    formLabel: 'نموذج الإبلاغ عن محتوى',
    targetHeading: 'المحتوى المُبلَّغ عنه',
    unknownTypeNotice: 'لم يُتعرّف على نوع المحتوى في هذا الرابط. اختر نوع المحتوى أدناه والصق رابط الأمة الآن أو المعرّف المرجعي.',
    resolvedTargetLabel: 'من رابطك',
    manualTypeLabel: 'عمّ تُبلِغ؟',
    manualTargetLabel: 'الرابط أو المعرّف المرجعي',
    manualTargetPlaceholder: 'الصق رابط المحتوى أو معرّفه',
    manualTargetHint: 'رابط من الأمة الآن لمرئي أو قناة أو بث مباشر أو منشور أو تعليق، أو معرّفه المرجعي.',
    types: {
      video: 'مرئي',
      channel: 'قناة',
      livestream: 'بث مباشر',
      live_chat: 'رسالة في محادثة بث',
      comment: 'تعليق',
      post: 'منشور',
    } as Record<GuestReportType, string>,
    targetIdLabel: 'المعرّف المرجعي',
    streamIdLabel: 'معرّف البث',
    messageIdLabel: 'معرّف الرسالة',
    reasonLabel: 'ما سبب الإبلاغ؟',
    priorityTag: 'يُراجَع أولًا',
    reasons: {
      child_safety: { label: 'سلامة الأطفال', hint: 'طفل قد يكون معرّضًا للخطر أو الأذى أو الاستغلال.' },
      harassment: { label: 'خطاب كراهية أو مضايقة', hint: 'إهانات أو تهديدات أو تنمّر أو تحريض على الكراهية.' },
      spam: { label: 'احتيال أو محتوى مضلّل أو مزعج', hint: 'عمليات نصب أو انتحال هوية أو محتوى خادع.' },
      violence: { label: 'عنف أو محتوى خطير', hint: 'عنف صريح أو إيذاء للنفس أو أعمال غير قانونية.' },
      copyright: { label: 'حقوق النشر', hint: 'محتوى نُشر دون إذن صاحبه.' },
      other: { label: 'سبب آخر', hint: 'مشكلة أخرى تتعلق بإرشادات المجتمع.' },
    } as Record<GuestReportReason, { label: string; hint: string }>,
    detailsLabel: 'تفاصيل (اختياري)',
    detailsHint: 'مثل الوقت في المرئي أو وصف المشكلة. من فضلك لا تكتب بيانات التواصل الخاصة بك.',
    signedInTitle: 'بلاغ من حسابك',
    signedInBody: 'يرتبط بلاغك بحسابك، ويرى المشرفون من أرسله.',
    privacyTitle: 'ما الذي نحفظه',
    privacyBody: 'البلاغ فقط: المحتوى الذي تُبلغ عنه والسبب وتفاصيلك. لا يُحفظ معه اسمك ولا بريدك ولا عنوانك. وللحد من إساءة الاستخدام نعدّ البلاغات لكل شبكة برمز مشفّر يُحذف خلال يومين.',
    honeypotLabel: 'الموقع الإلكتروني',
    submit: 'إرسال البلاغ',
    sending: 'جارٍ إرسال البلاغ…',
    errors: {
      summary: 'يرجى تصحيح ما يلي قبل الإرسال:',
      targetRequired: 'أدخل رابطًا من الأمة الآن أو المعرّف المرجعي للمحتوى الذي تُبلغ عنه.',
      unsupportedUrl: 'هذا الرابط لا يفتح عنصرًا واحدًا (مرئيًا أو قناة أو بثًا أو منشورًا أو تعليقًا) على الأمة الآن. الصق رابط المحتوى نفسه أو معرّفه المرجعي.',
      invalidId: 'هذا ليس معرّفًا مرجعيًا صالحًا. الصق الرابط بدلًا منه.',
      reasonRequired: 'اختر سبب الإبلاغ.',
      detailsTooLong: 'يجب ألا تتجاوز التفاصيل {max} حرفًا.',
      rateLimited: 'لا يمكننا استلام بلاغ آخر من هنا الآن. حاول لاحقًا، أو راسلنا:',
      contactLink: 'اتصل بنا',
      duplicate: 'سبق أن أبلغت عن هذا المحتوى.',
      signIn: 'انتهت جلستك. سجّل الدخول من جديد، أو سجّل الخروج للإبلاغ دون حساب.',
      unavailable: 'لا يمكن إرسال البلاغات الآن. حاول مرة أخرى بعد قليل.',
      network: 'تعذّر الاتصال بالخادم. تحقّق من اتصالك وحاول مرة أخرى.',
      generic: 'تعذّر إرسال بلاغك. حاول مرة أخرى.',
    },
    success: {
      title: 'أُرسل البلاغ',
      body: 'شكرًا لك. سيراجعه فريق الإشراف.',
      another: 'الإبلاغ عن محتوى آخر',
      home: 'العودة إلى الأمة الآن',
    },
    aside: {
      title: 'ماذا يحدث بعد ذلك',
      review: 'يراجع فريق الإشراف البلاغات وقد تستغرق المعالجة من ٢٤ إلى ٤٨ ساعة. تُراجَع بلاغات سلامة الأطفال أولًا.',
      danger: 'إذا كان طفل في خطر الآن فاتصل بخدمات الطوارئ في بلدك.',
      guidelines: 'اقرأ إرشادات المجتمع',
      privacy: 'اقرأ سياسة الخصوصية',
    },
    counter: '{count} / {max}',
  },
} as const;
