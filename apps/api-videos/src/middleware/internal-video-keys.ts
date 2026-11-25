import type { Context, Next } from 'hono';
import { isInternalVideoKey } from '@al-ummah/shared-types';
import { apiError } from '../lib/api-error';

const decoded = (part: string): string => {
	try {
		return decodeURIComponent(part);
	} catch {
		return part;
	}
};

/**
 * An id in the path, or in an id parameter, that names a record of the videos bucket which is not a video
 * (isInternalVideoKey) is nobody's video: 404 like any unknown id, on every route that takes one,
 * whichever way it reads the bucket. Ids in bodies and lists are refused by the readers
 * (lib/r2Repo.ts, lib/listFill.ts, lib/videoReadAccess.ts).
 */
export async function refuseInternalVideoKeys(c: Context, next: Next): Promise<Response | void> {
	const named = c.req.path.split('/').some((part) => isInternalVideoKey(decoded(part))) || Object.entries(c.req.queries()).some(([name, values]) => /ids?$/i.test(name) && values.some((value) => value.split(',').some(isInternalVideoKey)));
	if (named) return apiError(c, 404, 'not_found');
	await next();
}
