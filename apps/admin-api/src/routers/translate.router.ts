/**
 * /api/translate — machine translation for staff-set site fields (L10N rule, owner 2026-11-16:
 * "either the admin has to set it, or you provide a translation service from one to the other").
 *
 *   POST /fields   { from: 'en'|'ar', to: 'ar'|'en', texts: string[], field? }
 *                  → { items: [{ text, refused?, quran?, cached }], provider, machineTranslation, usage }
 *
 * Staff only (content:translate). The suggestion fills the other language in the form; the admin
 * reviews it and saves (nothing is written here). api-videos runs it (`/internal/translate/admin-fields`):
 * the translation kill switch, the inline budget ledger, the edge cache, a per-staff daily cap and the
 * translation_audit row live there; the processor runs Workers AI with the site's wording rules
 * («مرئي/مرئيات») and the CMS glossary, and refuses Quran text (never machine-translated) instead of
 * translating it. The texts are never logged or stored.
 */
import { Hono, type Context } from 'hono';
import { ADMIN_FIELD_LANGUAGES, ADMIN_FIELD_NAME, ADMIN_FIELD_TRANSLATE_LIMITS } from '@al-ummah/shared-types';
import { hasPermission } from '../lib/roles';
import { logger } from '../lib/logger';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings; Variables: { auth?: AuthContext } };
type C = Context<Env>;

const app = new Hono<Env>();

const fail = (c: C, status: number, code: string, extra: Record<string, unknown> = {}) => c.json({ success: false, code, error: code, ...extra }, status as 400);

/** Checks the request; the error code, or null when it is fine. */
export function validateFieldTranslate(body: unknown): { code: string; extra?: Record<string, unknown> } | null {
  const b = body as { from?: unknown; to?: unknown; texts?: unknown; field?: unknown } | null;
  if (!b || typeof b !== 'object') return { code: 'invalid_request' };
  const langs = ADMIN_FIELD_LANGUAGES as readonly unknown[];
  if (!langs.includes(b.from) || !langs.includes(b.to)) return { code: 'invalid_language' };
  if (b.from === b.to) return { code: 'same_language' };
  if (b.field !== undefined && (typeof b.field !== 'string' || !ADMIN_FIELD_NAME.test(b.field))) return { code: 'invalid_field' };
  if (!Array.isArray(b.texts) || !b.texts.length || b.texts.length > ADMIN_FIELD_TRANSLATE_LIMITS.texts) return { code: 'too_many_texts', extra: { max: ADMIN_FIELD_TRANSLATE_LIMITS.texts } };
  let chars = 0;
  for (const t of b.texts) {
    if (typeof t !== 'string') return { code: 'invalid_request' };
    if (t.length > ADMIN_FIELD_TRANSLATE_LIMITS.textChars) return { code: 'text_too_long', extra: { max: ADMIN_FIELD_TRANSLATE_LIMITS.textChars } };
    chars += t.length;
  }
  if (chars > ADMIN_FIELD_TRANSLATE_LIMITS.chars) return { code: 'too_much_text', extra: { max: ADMIN_FIELD_TRANSLATE_LIMITS.chars } };
  return null;
}

async function internalKey(env: AdminBindings): Promise<string> {
  const v = env.INTERNAL_API_KEY as string | { get(): Promise<string> } | undefined;
  return typeof v === 'string' ? v : ((await v?.get().catch(() => '')) ?? '');
}

app.post('/fields', async (c) => {
  const auth = c.get('auth');
  if (!hasPermission(auth?.roles, 'content:translate')) {
    logger.warn('[Translate] Permission denied', { userId: auth?.userId });
    return fail(c, 403, 'forbidden');
  }
  const body = (await c.req.json().catch(() => null)) as { from: string; to: string; texts: string[]; field?: string } | null;
  const invalid = validateFieldTranslate(body);
  if (invalid) return fail(c, 400, invalid.code, invalid.extra);
  const key = await internalKey(c.env);
  const path = '/internal/translate/admin-fields';
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-Key': key, 'X-Admin-Actor': auth?.userId ?? 'unknown' },
    body: JSON.stringify({ userId: auth?.userId ?? 'unknown', from: body!.from, to: body!.to, texts: body!.texts, field: body!.field ?? 'field' }),
  };
  let res: Response | null = null;
  try {
    res = c.env.VIDEOS
      ? await c.env.VIDEOS.fetch(`https://videos.internal${path}`, init)
      : c.env.VIDEOS_API_URL
        ? await fetch(`${c.env.VIDEOS_API_URL.replace(/\/$/, '')}${path}`, init)
        : null;
  } catch (error) {
    logger.error('[Translate] api-videos unreachable', { error: error instanceof Error ? error.message : String(error) });
    return fail(c, 503, 'unavailable');
  }
  if (!res || !key) return fail(c, 503, 'unavailable');
  const answer = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown; error?: string; [k: string]: unknown } | null;
  if (!res.ok || !answer?.success) {
    // Known refusals pass through (paused, budget spent, daily cap, invalid); anything else is a 502
    const code = typeof answer?.error === 'string' ? answer.error : 'translation_failed';
    const extra = Object.fromEntries(Object.entries(answer ?? {}).filter(([k]) => k !== 'success' && k !== 'error'));
    if ([400, 429, 503].includes(res.status)) return fail(c, res.status, code, extra);
    logger.error('[Translate] Field translation failed', { status: res.status, code });
    return fail(c, 502, 'translation_failed');
  }
  logger.info('[Translate] Fields translated', { userId: auth?.userId, field: body!.field ?? 'field', from: body!.from, to: body!.to, texts: body!.texts.length });
  return c.json({ success: true, result: answer.data });
});

export default app;
