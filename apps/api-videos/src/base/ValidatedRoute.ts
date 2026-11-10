import { OpenAPIRoute, type ValidatedData } from 'chanfana';
import type { ZodIssue } from 'zod';

/**
 * A request that fails the endpoint's schema is the caller's mistake: 400 with
 * the issues, never a 500.
 *
 * chanfana already answers 400 when getValidatedData() throws a ZodError out of
 * handle(), but most handlers wrap their whole body (validation included) in a
 * try/catch that turns every error into a 500. This base remembers a schema
 * failure and, when the handler answered it with a 5xx, replaces that answer
 * with chanfana's own 400 validation response. Handlers that answer a schema
 * failure themselves with a 4xx keep their answer.
 */
export abstract class ValidatedRoute extends OpenAPIRoute {
  private requestIssues: ZodIssue[] | undefined;

  async getValidatedData<S = any>(): Promise<ValidatedData<S>> {
    try {
      return await super.getValidatedData<S>();
    } catch (e) {
      const issues = zodIssues(e);
      if (issues) this.requestIssues = issues;
      throw e;
    }
  }

  async execute(...args: any[]): Promise<Response> {
    this.requestIssues = undefined;
    const resp = await super.execute(...(args as Parameters<OpenAPIRoute['execute']>));
    const issues = this.requestIssues;
    if (issues && resp.status >= 500) return this.handleValidationError(issues);
    return resp;
  }
}

/** The issues of a ZodError (by shape: chanfana may bundle its own zod copy). */
export function zodIssues(e: unknown): ZodIssue[] | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const err = e as { name?: unknown; issues?: unknown };
  return err.name === 'ZodError' && Array.isArray(err.issues) ? (err.issues as ZodIssue[]) : undefined;
}
