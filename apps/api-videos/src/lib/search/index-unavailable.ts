/**
 * A public list whose index cannot be read (D1 failed). The list answers 503 with Retry-After
 * (error-handler.ts); it never reads the bucket instead: that is slower the larger the catalogue
 * is, and shows whichever keys come first.
 */
export class IndexUnavailableError extends Error {
	readonly status = 503;
	readonly retryAfterSeconds = 5;
	constructor() {
		super('The index cannot be read right now');
		this.name = 'IndexUnavailableError';
	}
}
