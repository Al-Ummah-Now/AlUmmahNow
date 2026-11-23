/**
 * Every error answer leaves in the one envelope (wiki AUN-FEATURES §5.2, decision O40):
 * stable `code`, a localized `message` (the app's X-App-Locale, else the URL's language, else English; never Accept-Language), `action`, and
 * `retryAfter` / `reference` when known. Registered outermost so it also wraps onError's answers.
 */
import type { MiddlewareHandler } from 'hono';
import { envelopeResponse } from '@al-ummah/shared-types';

export const errorEnvelope: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status < 400) return;
  c.res = await envelopeResponse(c.res, c.req.raw);
};
