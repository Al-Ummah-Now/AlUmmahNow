import { z } from 'zod';

/**
 * When to read again, for clients that poll (the native apps have no chat socket; wiki E17 §5.2). Part of the contract
 * and not sent yet: installed apps already follow it, so the server can slow them down without an app update.
 */
export const PollAfterMs = z
	.number()
	.int()
	.positive()
	.optional()
	.describe('Optional. Milliseconds until this should be read again. Clients keep it between 5000 and 600000, and use their own interval when it is absent. `Retry-After` (seconds) on a 429 or 503 is followed in the same way.');
