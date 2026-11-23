/**
 * Why a social import job failed, as stored for the admin (wiki TOOLS-ADMIN TA-9): `"<code>: <detail>"`, the form
 * of every reason on a source (`import_sources.last_error`), on its job (`lastError`) and in the job's log. The
 * app and the videos admin show the code in the admin's language and the detail (English, technical) on its own
 * line. Codes are stable; the detail is not.
 *
 *   source_unreachable   nothing answered, it timed out, a 5xx or 429, too many redirects, or a private address
 *   source_not_found     404 or 410 (or no account with that name)
 *   source_forbidden     401 or 403
 *   source_bad_response  another answer the sync can't use (another 4xx, too large, not the expected content)
 *   source_not_a_feed    not an RSS or Atom feed
 *   …                    any other SourceError keeps its own code (channel_unavailable, not_connected, …)
 *   sync_failed          anything else in a sync (the message is the detail)
 *   takeout_failed       anything else in a Takeout match job
 */
import { PreviewError } from '../link-preview';
import { SourceError } from './store';

/** A fetch refusal, in the codes the admin's apps translate. */
export function sourceErrorFromPreview(error: PreviewError): SourceError {
	const status = error.status;
	const http = status ? `http_${status}` : null;
	if (status === 404 || status === 410) return new SourceError(502, 'source_not_found', `The source was not found (${http})`);
	if (status === 401 || status === 403) return new SourceError(502, 'source_forbidden', `The source refused access (${http})`);
	if (error.code === 'unreachable' && (!status || status >= 500 || status === 429)) {
		return new SourceError(502, 'source_unreachable', `The source could not be read (${http ?? 'no_answer'})`, error.retryAfter);
	}
	if (error.code === 'too_many_redirects') return new SourceError(502, 'source_unreachable', 'The source could not be read (too_many_redirects)');
	if (error.code === 'blocked' || error.code === 'bad_url') return new SourceError(502, 'source_unreachable', `The source could not be read (${error.code === 'blocked' ? 'private_address' : 'bad_url'})`);
	return new SourceError(502, 'source_bad_response', `The source gave an answer the sync can't use (${http ?? error.code})`);
}

const CODED = /^[a-z][a-z0-9_]{1,40}: /;

/** The stored reason of a job that threw: `"<code>: <detail>"`. */
export function codedReason(error: unknown, fallback: 'sync_failed' | 'takeout_failed'): string {
	if (error instanceof PreviewError) return codedReason(sourceErrorFromPreview(error), fallback);
	if (error instanceof SourceError) return `${error.code}: ${error.message && error.message !== error.code ? error.message : error.code}`;
	const message = error instanceof Error ? error.message : String(error);
	return CODED.test(message) ? message : `${fallback}: ${message || 'unknown error'}`;
}

/** An Error carrying the coded reason (the job queue stores the message as the job's reason). */
export function codedError(error: unknown, fallback: 'sync_failed' | 'takeout_failed'): Error {
	const coded = new Error(codedReason(error, fallback));
	if (error instanceof Error && error.stack) coded.stack = error.stack;
	return coded;
}
