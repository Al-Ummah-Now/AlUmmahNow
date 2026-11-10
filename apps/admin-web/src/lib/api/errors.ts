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
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

/** Result shape for mutations invoked from client components. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };
