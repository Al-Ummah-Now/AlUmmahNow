/**
 * What a public page (watch, playlist) answers for an id, decided on the server so the
 * response status is true (docs: wiki AUN-SEO, "Deleted, private and scheduled content"):
 *
 * - `public`: anyone can see it: 200, indexable.
 * - `restricted`: anonymous callers get a 4xx but the signed-in viewer may see it (their own
 *   private video, a channel member's draft): 200 with noindex.
 * - `missing`: nobody here may see it (never existed, private, deleted, hidden, scheduled):
 *   404. Never 403, which would confirm that a private id exists.
 * - `unavailable`: the API could not answer (network error, 5xx, 429): the page throws, and the
 *   worker turns the 500 into a 503 with Retry-After (worker.ts), never a "not found".
 */

export type Availability = 'public' | 'restricted' | 'missing' | 'unavailable';

/** null = the API could not be reached */
export type ApiStatus = number | null;

const isOk = (status: ApiStatus) => status !== null && status >= 200 && status < 300;
const isDown = (status: ApiStatus) => status === null || status >= 500 || status === 429;

/**
 * @param anonymous the anonymous API status for the id
 * @param signedIn  looks the id up as the signed-in viewer; resolves to undefined when nobody is
 *                  signed in. Only called when the anonymous answer is a 4xx.
 */
export async function classifyAvailability(
  anonymous: ApiStatus,
  signedIn: () => Promise<ApiStatus | undefined>,
): Promise<Availability> {
  if (isOk(anonymous)) return 'public';
  if (isDown(anonymous)) return 'unavailable';
  const viewer = await signedIn();
  if (viewer === undefined) return 'missing';
  if (isOk(viewer)) return 'restricted';
  if (isDown(viewer)) return 'unavailable';
  return 'missing';
}

/** Thrown by a page when the API is down: rendered as 503 + Retry-After by worker.ts. */
export class ContentUnavailableError extends Error {
  constructor(what: string) {
    super(`Content API unavailable while loading ${what}`);
    this.name = 'ContentUnavailableError';
  }
}
