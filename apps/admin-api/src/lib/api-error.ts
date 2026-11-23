/**
 * Every error answer goes through here (wiki AUN-FEATURES §5.2, FEAT-3): a catalogue code from
 * @al-ummah/shared-types (API_ERROR_CATALOGUE), and anything extra. The error envelope middleware
 * (middleware/error-envelope.ts) adds the message in the caller's language, `lang` and `action`.
 * A hand-written `{ success: false, ... }` body fails `pnpm check:error-bodies`.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { apiErrorBody, type ApiErrorExtra } from '@al-ummah/shared-types';

export function apiError(
  c: Context<any, any, any>,
  status: ContentfulStatusCode,
  code: string,
  extra?: ApiErrorExtra,
  headers?: Record<string, string>,
): Response {
  return c.json(apiErrorBody(code, extra), status, headers);
}
