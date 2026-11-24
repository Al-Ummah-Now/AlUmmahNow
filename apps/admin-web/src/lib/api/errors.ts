/**
 * Error raised by the admin-api client. Kept outside the 'use server' module
 * because those files may only export async functions.
 */
export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Machine-readable error code from admin-api (e.g. "handle_taken"), when given. */
    public readonly code?: string,
    /** Why admin-api refused a settings change (shared-types settingsProblems shape), when given. */
    public readonly problems?: { problem: string; detail?: string }[],
    /** Per-field error codes (e.g. { labelEn: 'required' }), when given. */
    public readonly fields?: Record<string, string>,
    /** The whole error body, for callers that read more of it (the Features page's 409 carries the feature as it is now). */
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/** Result shape for mutations invoked from client components. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string; problems?: { problem: string; detail?: string }[] };

/** A change its approval rule sent for approval instead (admin-api answered 202 pending_approval): nothing changed yet. */
export type SentForApproval = { ok: 'sent'; requestId: string };
/** A mutation on a governed setting: changed at once, sent for approval, or refused. */
export type GovernedResult<T> = ActionResult<T> | SentForApproval;

/** The change request in a governed route's answer, when the change waits for approval. */
export function sentForApproval(result: unknown): SentForApproval | null {
  const r = result as { status?: unknown; request?: { id?: unknown } } | null | undefined;
  return r?.status === 'pending_approval' && typeof r.request?.id === 'string' ? { ok: 'sent', requestId: r.request.id } : null;
}
