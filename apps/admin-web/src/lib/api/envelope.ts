/**
 * Reading admin-api's error bodies (pure, so tests need no Next.js or session): the text to show and
 * the problems of a refused change.
 */
export type ErrorBody = {
  success?: boolean;
  error?: string;
  code?: unknown;
  message?: unknown;
  errors?: { message?: string }[];
  [key: string]: unknown;
};

/**
 * The text to show for a refused call. admin-api's error envelope (FEAT-3) puts the code in `error`
 * and the sentence, already in the admin's language (X-App-Locale), in `message`: show the sentence.
 * Older bodies whose `error` is itself a sentence keep it.
 */
export function envelopeError(body: ErrorBody, fallback: string): string {
  const code = typeof body.code === 'string' ? body.code : undefined;
  const message = typeof body.message === 'string' && body.message.trim() ? body.message : undefined;
  const error = typeof body.error === 'string' && body.error.trim() ? body.error : undefined;
  const errorIsCode = !!error && (error === code || /^[a-z][a-z0-9_]*$/.test(error));
  if (error && !(errorIsCode && message)) return error;
  return message || body.errors?.[0]?.message || fallback;
}

/**
 * A refused change's problems, as { problem, detail? } (at most 20). Settings send objects; the approval
 * workflow sends plain codes (['below_floor_approvals']), kept as { problem }.
 */
export function problemsOf(value: unknown): { problem: string; detail?: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((p) => (typeof p === 'string' && p.length <= 80 ? { problem: p } : p))
    .filter((p): p is { problem: string; detail?: unknown } => !!p && typeof p === 'object' && typeof (p as { problem?: unknown }).problem === 'string')
    .slice(0, 20)
    .map((p) => ({ problem: p.problem, ...(typeof p.detail === 'string' ? { detail: p.detail } : {}) }));
  return out.length ? out : undefined;
}
