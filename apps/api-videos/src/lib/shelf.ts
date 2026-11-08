import type { Context } from "hono";
import { logger } from "./logger";

/**
 * Response for a home/watch-page video shelf whose lookup failed.
 *
 * A shelf is decoration around the page: when its index or storage read
 * fails it answers 200 with an empty list, so the page renders without that
 * row instead of surfacing an error (#304). The cause is logged, never sent
 * to the client.
 */
export function emptyShelf(c: Context, section: string, error: unknown) {
	logger.error(`Video shelf "${section}" failed; answering with an empty list`, {
		error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
	});
	return c.json({
		success: true,
		data: [],
		cursor: undefined,
		metadata: { lastUpdated: new Date().toISOString(), degraded: true },
	});
}
