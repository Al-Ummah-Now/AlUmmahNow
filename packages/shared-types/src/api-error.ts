/**
 * One error envelope for every API we own (wiki AUN-FEATURES §5.2, decision O40; owner 2026-11-22:
 * errors from the server must show properly "even when a client doesn't support them yet").
 *
 *   { success: false, code, message, lang, action, retryAfter?, helpUrl?, reference?, feature?,
 *     error (old clients), errors (chanfana field list, 400s) }
 *
 * - `code` is stable snake_case; clients branch on it, never on the text.
 * - `message` is a whole sentence for a person, in `lang`, from the catalogue below, never from an
 *   exception, a binding or a provider: no internals reach users.
 * - A client that doesn't know `code` shows `message` as sent, with the button for `action`.
 * - The status code never changes; `feature_off` stays 404.
 *
 * `buildErrorEnvelope` is pure: each worker's response middleware calls it for every
 * `success: false` JSON answer, so endpoints written before the envelope get it too.
 */
import { featureOffMessage, isFeatureKey, type FeatureKey } from './feature-registry';

export type ApiErrorLang = 'en' | 'ar';
export const API_ERROR_ACTIONS = ['retry', 'sign_in', 'update_app', 'contact_support', 'none'] as const;
export type ApiErrorAction = (typeof API_ERROR_ACTIONS)[number];

export interface ApiErrorBody {
  success: false;
  code: string;
  message: string;
  lang: ApiErrorLang;
  action: ApiErrorAction;
  retryAfter?: number;
  helpUrl?: string;
  reference?: string;
  feature?: FeatureKey;
  /** Kept for clients written before the envelope (its old value) */
  error?: unknown;
  /** chanfana's field list on validation errors */
  errors?: unknown;
  [extra: string]: unknown;
}

interface CatalogueEntry {
  action: ApiErrorAction;
  en: string;
  ar: string;
}

/** Messages by code. Codes may be added, never renamed. */
export const API_ERROR_CATALOGUE: Readonly<Record<string, CatalogueEntry>> = Object.freeze({
  // 400 family
  bad_request: { action: 'none', en: 'Something in this request isn’t right. Check it and try again.', ar: 'في هذا الطلب ما لا يصح. راجعه وحاول مرة أخرى.' },
  invalid_request: { action: 'none', en: 'Some details aren’t right. Check them and try again.', ar: 'بعض التفاصيل غير صحيحة. راجعها وحاول مرة أخرى.' },
  validation_error: { action: 'none', en: 'Some details aren’t right. Check them and try again.', ar: 'بعض التفاصيل غير صحيحة. راجعها وحاول مرة أخرى.' },
  unauthorized: { action: 'sign_in', en: 'Please sign in again.', ar: 'يُرجى تسجيل الدخول مرة أخرى.' },
  authentication_required: { action: 'sign_in', en: 'Please sign in to continue.', ar: 'يُرجى تسجيل الدخول للمتابعة.' },
  token_expired: { action: 'sign_in', en: 'Your session has ended. Please sign in again.', ar: 'انتهت جلستك. يُرجى تسجيل الدخول مرة أخرى.' },
  forbidden: { action: 'none', en: 'You don’t have permission to do this.', ar: 'ليست لديك صلاحية للقيام بهذا.' },
  not_found: { action: 'none', en: 'We couldn’t find what you were looking for.', ar: 'لم نعثر على ما تبحث عنه.' },
  video_not_found: { action: 'none', en: 'This video isn’t available.', ar: 'هذا المرئي غير متاح.' },
  channel_not_found: { action: 'none', en: 'This channel isn’t available.', ar: 'هذه القناة غير متاحة.' },
  playlist_not_found: { action: 'none', en: 'This playlist isn’t available.', ar: 'قائمة التشغيل هذه غير متاحة.' },
  method_not_allowed: { action: 'none', en: 'This action isn’t possible here.', ar: 'لا يمكن القيام بهذا الإجراء هنا.' },
  conflict: { action: 'retry', en: 'This changed while you were working on it. Reload and try again.', ar: 'تغيّر هذا أثناء عملك عليه. أعد التحميل وحاول مرة أخرى.' },
  feature_changed: { action: 'none', en: 'Someone else changed this a moment ago.', ar: 'غيّر شخص آخر هذا قبل لحظات.' },
  payload_too_large: { action: 'none', en: 'This is too large to send.', ar: 'هذا أكبر من أن يُرسل.' },
  rate_limited: { action: 'retry', en: 'That was a lot of requests in a short time. Please wait a moment and try again.', ar: 'كانت هذه طلبات كثيرة في وقت قصير. يُرجى الانتظار قليلًا ثم المحاولة مرة أخرى.' },
  human_check_failed: { action: 'retry', en: 'We couldn’t confirm you’re a person. Please try again.', ar: 'لم نتمكن من التأكد من أنك شخص. يُرجى المحاولة مرة أخرى.' },
  unsupported_api_version: { action: 'update_app', en: 'This version of the app is no longer supported. Please update it.', ar: 'لم يعد هذا الإصدار من التطبيق مدعومًا. يُرجى تحديثه.' },
  app_update_required: { action: 'update_app', en: 'Please update the app to continue.', ar: 'يُرجى تحديث التطبيق للمتابعة.' },
  // Feature switches (the message comes from the registry entry; this is the fallback)
  feature_off: { action: 'none', en: 'This feature isn’t available right now.', ar: 'هذه الميزة غير متاحة الآن.' },
  // 500 family
  server_error: { action: 'retry', en: 'Something on our side failed. We’ve been told, so please try again in a moment.', ar: 'حدث خطأ من جهتنا وأُبلغنا به. يُرجى المحاولة بعد قليل.' },
  internal_error: { action: 'retry', en: 'Something on our side failed. We’ve been told, so please try again in a moment.', ar: 'حدث خطأ من جهتنا وأُبلغنا به. يُرجى المحاولة بعد قليل.' },
  service_unavailable: { action: 'retry', en: 'This is unavailable for a moment. Please try again shortly.', ar: 'هذا غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
  storage_unavailable: { action: 'retry', en: 'This is unavailable for a moment. Please try again shortly.', ar: 'هذا غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
  index_unavailable: { action: 'retry', en: 'This is unavailable for a moment. Please try again shortly.', ar: 'هذا غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
  search_unavailable: { action: 'retry', en: 'Search is unavailable for a moment. Please try again shortly.', ar: 'البحث غير متاح لحظيًا. يُرجى المحاولة بعد قليل.' },
});

const CODE_SHAPE = /^[a-z][a-z0-9_]{1,63}$/;

/** The code for a status when the answer names none. */
export function codeForStatus(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 405) return 'method_not_allowed';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 422) return 'invalid_request';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'service_unavailable';
  if (status >= 500) return 'server_error';
  return 'bad_request';
}

function catalogueFor(code: string, status: number): CatalogueEntry {
  return API_ERROR_CATALOGUE[code] ?? API_ERROR_CATALOGUE[codeForStatus(status)];
}

/**
 * The language of an error message: the first `ar…` or `en…` tag of Accept-Language by quality,
 * else the app's language header (X-App-Locale), else English.
 */
export function negotiateErrorLang(acceptLanguage?: string | null, appLocale?: string | null): ApiErrorLang {
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((t) => t.tag && t.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of tags) {
    if (tag === 'ar' || tag.startsWith('ar-')) return 'ar';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  const app = (appLocale ?? '').trim().toLowerCase();
  if (app === 'ar' || app.startsWith('ar-') || app.startsWith('ar_')) return 'ar';
  return 'en';
}

/** The message for a code in a language (`feature` names the switched-off feature). */
export function apiErrorMessage(code: string, status: number, lang: ApiErrorLang, feature?: string | null): string {
  if (code === 'feature_off') return featureOffMessage(isFeatureKey(feature) ? feature : null, lang);
  return catalogueFor(code, status)[lang];
}

export interface EnvelopeContext {
  status: number;
  lang: ApiErrorLang;
  /** The Retry-After header already on the answer, if any */
  retryAfterHeader?: string | null;
  /** The X-Error-Ref header already on the answer, if any */
  referenceHeader?: string | null;
}

/** True for a JSON body that is an error answer we should fill in. */
export function isErrorBody(status: number, body: unknown): body is Record<string, unknown> {
  if (status < 400 || !body || typeof body !== 'object' || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  if (b.success === false) return true;
  return !('success' in b) && (typeof b.error === 'string' || typeof b.code === 'string');
}

/**
 * Completes an error answer's body. Existing fields stay (old clients read them). The message
 * is the catalogue's for a known code; for a code the catalogue doesn't know, an English
 * endpoint message is kept for English callers and the status fallback is used otherwise, so an
 * Arabic interface never gets English text.
 */
export function buildErrorEnvelope(body: Record<string, unknown>, ctx: EnvelopeContext): ApiErrorBody {
  const { status, lang } = ctx;
  const legacyError = body.error;
  const explicitCode = typeof body.code === 'string' && CODE_SHAPE.test(body.code) ? body.code : null;
  const errorCode = typeof legacyError === 'string' && CODE_SHAPE.test(legacyError) ? legacyError : null;
  const chanfanaErrors = Array.isArray(body.errors);
  const code = explicitCode ?? errorCode ?? (chanfanaErrors && status === 400 ? 'invalid_request' : codeForStatus(status));
  const feature = typeof body.feature === 'string' && isFeatureKey(body.feature) ? body.feature : undefined;

  const known = code === 'feature_off' || code in API_ERROR_CATALOGUE;
  const endpointMessage = typeof body.message === 'string' && body.message.trim() ? body.message : null;
  const alreadyLocalized = body.lang === 'en' || body.lang === 'ar';
  let message: string;
  if (alreadyLocalized && endpointMessage) message = endpointMessage;
  else if (known) message = apiErrorMessage(code, status, lang, feature);
  else if (lang === 'en' && endpointMessage && status < 500) message = endpointMessage;
  else message = apiErrorMessage(code, status, lang);

  const actionRaw = body.action;
  const action: ApiErrorAction = typeof actionRaw === 'string' && (API_ERROR_ACTIONS as readonly string[]).includes(actionRaw)
    ? (actionRaw as ApiErrorAction)
    : code === 'feature_off' ? 'none' : catalogueFor(code, status).action;

  const out: ApiErrorBody = {
    ...body,
    success: false,
    code,
    message,
    lang: alreadyLocalized && endpointMessage ? (body.lang as ApiErrorLang) : lang,
    action,
  };
  if (!('error' in body)) out.error = code;
  if (feature) out.feature = feature;
  else delete out.feature;

  const retry = typeof body.retryAfter === 'number' ? body.retryAfter : Number(ctx.retryAfterHeader);
  if (Number.isFinite(retry) && retry > 0) out.retryAfter = Math.ceil(retry);
  else delete out.retryAfter;

  const reference = typeof body.reference === 'string' ? body.reference : ctx.referenceHeader ?? undefined;
  if (reference) out.reference = reference;

  if (typeof body.helpUrl !== 'string' || !/^https:\/\//.test(body.helpUrl)) delete out.helpUrl;
  return out;
}

/** What a client reads from any error answer: never throws; no envelope → no message. */
export interface ParsedApiError {
  status: number;
  code: string;
  message?: string;
  lang?: ApiErrorLang;
  action: ApiErrorAction;
  retryAfter?: number;
  helpUrl?: string;
  reference?: string;
  feature?: FeatureKey;
}

export function parseApiError(status: number, body: unknown): ParsedApiError {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const code = typeof b.code === 'string' && CODE_SHAPE.test(b.code)
    ? b.code
    : typeof b.error === 'string' && CODE_SHAPE.test(b.error) ? b.error : `http_${status}`;
  const lang = b.lang === 'ar' || b.lang === 'en' ? b.lang : undefined;
  const action = typeof b.action === 'string' && (API_ERROR_ACTIONS as readonly string[]).includes(b.action) ? (b.action as ApiErrorAction) : 'none';
  return {
    status,
    code,
    message: lang && typeof b.message === 'string' && b.message.trim() ? b.message : undefined,
    lang,
    action,
    retryAfter: typeof b.retryAfter === 'number' && b.retryAfter > 0 ? b.retryAfter : undefined,
    helpUrl: typeof b.helpUrl === 'string' && /^https:\/\//.test(b.helpUrl) ? b.helpUrl : undefined,
    reference: typeof b.reference === 'string' ? b.reference : undefined,
    feature: typeof b.feature === 'string' && isFeatureKey(b.feature) ? b.feature : undefined,
  };
}

/** The headers an error answer varies on (its message language). */
export const API_ERROR_VARY = 'Accept-Language, X-App-Locale';

const MAX_ENVELOPE_BODY = 64 * 1024;

/**
 * Wraps a finished error answer in the envelope (any worker, plain Fetch API). Leaves alone:
 * successes, non-JSON bodies, bodies over 64 KiB and JSON that isn't an error object.
 */
export async function envelopeResponse(res: Response, req: Request): Promise<Response> {
  if (res.status < 400 || !res.body) return res;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return res;
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ENVELOPE_BODY) return res;
  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return res;
  }
  if (text.length > MAX_ENVELOPE_BODY) return res;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return res;
  }
  if (!isErrorBody(res.status, body)) return res;
  const lang = negotiateErrorLang(req.headers.get('accept-language'), req.headers.get('x-app-locale'));
  const envelope = buildErrorEnvelope(body, {
    status: res.status,
    lang,
    retryAfterHeader: res.headers.get('retry-after'),
    referenceHeader: res.headers.get('x-error-ref'),
  });
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('content-language', envelope.lang);
  const vary = headers.get('vary');
  const have = new Set((vary ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean));
  if (!have.has('*')) {
    const add = API_ERROR_VARY.split(', ').filter((v) => !have.has(v.toLowerCase()));
    if (add.length) headers.set('vary', [vary, ...add].filter(Boolean).join(', '));
  }
  if (envelope.retryAfter && !headers.has('retry-after')) headers.set('retry-after', String(envelope.retryAfter));
  return new Response(JSON.stringify(envelope), { status: res.status, statusText: res.statusText, headers });
}
