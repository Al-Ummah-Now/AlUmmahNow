import { ApiException, OpenAPIRoute, type ValidatedData } from 'chanfana';

/**
 * A request that fails the endpoint's schema is the caller's mistake: 400 with
 * the issues, never a 500.
 *
 * chanfana already answers 400 when getValidatedData() throws its validation
 * exception out of handle(), but most handlers wrap their whole body (validation
 * included) in a try/catch that turns every error into a 500. This base
 * remembers a schema failure and, when the handler answered it with a 5xx,
 * replaces that answer with chanfana's own 400 validation response. Handlers
 * that answer a schema failure themselves with a 4xx keep their answer.
 */
export abstract class ValidatedRoute extends OpenAPIRoute {
  private requestError: ApiException | undefined;

  async getValidatedData<S = any>(): Promise<ValidatedData<S>> {
    try {
      return await super.getValidatedData<S>();
    } catch (e) {
      if (isValidationError(e)) this.requestError = e;
      throw e;
    }
  }

  async execute(...args: any[]): Promise<Response> {
    this.requestError = undefined;
    let resp: Response;
    try {
      resp = await super.execute(...(args as Parameters<OpenAPIRoute['execute']>));
    } catch (e) {
      // fromHono() makes chanfana 3 re-throw its own errors to app.onError; answer them here, as chanfana 2 did
      if (e instanceof ApiException) return chanfanaErrorResponse(e);
      throw e;
    }
    const error = this.requestError;
    if (error && resp.status >= 500) return chanfanaErrorResponse(error);
    return resp;
  }
}

/**
 * chanfana 3 reports a schema failure as a MultiException of InputValidationExceptions
 * (status 400, one `{ code: 7001, message, path }` per issue).
 */
function isValidationError(e: unknown): e is ApiException {
  return e instanceof ApiException && e.status === 400;
}

/** chanfana's error body (`result: {}` as chanfana 2 sent it). */
export function chanfanaErrorResponse(error: ApiException): Response {
  return new Response(JSON.stringify({ success: false, errors: error.buildResponse(), result: {} }), {
    status: error.status,
    headers: { 'content-type': 'application/json' },
  });
}
