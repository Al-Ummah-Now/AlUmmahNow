/**
 * The answer is the caller's alone (it carries a signed URL, say): no cache keeps it.
 *
 * Not c.header(): a handler that returns a plain object has its Response built by chanfana, which does not take
 * over the headers c.header() prepared. What is set on c.res is carried over to it.
 */
export function privateAnswer(c: { res: Response }): void {
	c.res.headers.set('Cache-Control', 'private, no-store');
}
