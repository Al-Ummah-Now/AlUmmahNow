/**
 * What the read-only ops reports (prod-errors, media-diagnostics) may print. Their logs, summaries and
 * artifacts are public, so every line goes through `scrub`, which is safe to run twice:
 *  - dropped: URL query strings, credentials, JWTs, emails, IP addresses, user ids, handles, and the
 *    values of fields that name a person or their content (PERSONAL_KEYS), home and network folders;
 *  - shortened to 8 characters: UUIDs (videos, jobs, import batches, versions), long hex (hashes, instance
 *    ids) and the value of any other "…Id" field. Enough for an admin to find the record, too little to open it.
 * Kept: error groups (eg_…), request ids (ray), releases, our own package scopes in stack frames.
 *
 * `clip` scrubs before it cuts, so a cut never leaves half an email, id or token that no pattern matches.
 */

/** Fields whose value is a person, or a person's own text: never printed. */
export const PERSONAL_KEYS = [
	'user_?ids?', 'owner_?id', 'actor_?id', 'admin_?id', 'uploader_?id', 'uploaded_?by', 'created_?by', 'updated_?by', 'reporter_?id', 'reviewer_?id',
	'viewer_?id', 'member_?id', 'subscriber_?id', 'author_?id', 'sub', 'subject', 'account_?id',
	'handle', 'user_?name', 'display_?name', 'channel_?name', 'full_?name', 'first_?name', 'last_?name',
	'title', 'description', 'file_?name', 'email', 'phone', 'ip', 'ip_?hash', 'q', 'query', 'search',
].join('|');

const JSON_FIELD = new RegExp(`("(?:${PERSONAL_KEYS})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*(?:"|$)`, 'gi');
const ESCAPED_JSON_FIELD = new RegExp(`(\\\\"(?:${PERSONAL_KEYS})\\\\"\\s*:\\s*)\\\\"[^"\\\\]*(?:\\\\"|$)`, 'gi');
const ASSIGNED = new RegExp(`\\b((?:${PERSONAL_KEYS})=)(?!…)[^\\s,;&"']+`, 'gi');
/** Package scopes of our stack frames: never a handle. */
const SCOPES = 'al-ummah|opennextjs|cloudflare|hono|tanstack|types|babel|swc|next';

export function scrub(text: string): string {
	return (
		text
			.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']*/g, '$1?…')
			.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer …')
			.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '…jwt…')
			.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, '…@…')
			// An address the stored sample was cut in the middle of
			.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]*$/u, '…@…')
			.replace(/("?(?:[a-z_-]*(?:token|secret|password|signature|api[_-]?key|authorization|cookie|x-amz-[a-z-]+))"?\s*[:=]\s*)("[^"]*"|[^\s,}&]+)/gi, '$1"…"')
			.replace(JSON_FIELD, '$1"…"')
			.replace(ESCAPED_JSON_FIELD, '$1\\"…\\"')
			.replace(ASSIGNED, '$1…')
			.replace(/usr_[A-Za-z0-9]+/g, 'usr_…')
			.replace(/\buser:[0-9a-f]{8,}/gi, 'user:…')
			// Handles: @name, percent-encoded, and the routes that carry one
			.replace(new RegExp(`(?<![\\p{L}\\p{N}_…]|node_modules\\/|\\.pnpm\\/)@(?!(?:${SCOPES})[/+])[\\p{L}\\p{N}_][^\\s"'\\\\/?#,;:)\\]}]*`, 'giu'), '@…')
			.replace(/%40[^\s"'\\/?#,;)\]}]+/g, '@…')
			.replace(/(\/(?:by-handle|handles|c|u|slug)\/)(?![:…])[^\s"'\\/?#,;)\]}]+/g, '$1…')
			// Home and network folders
			.replace(/([A-Za-z]:(?:\\{1,2})Users\\{1,2})[^\\"'\r\n]+/gi, '$1…')
			.replace(/(\/(?:Users|home)\/)(?!runner\/)[^\s/"']+/g, '$1…')
			.replace(/(?<![\\\w:])\\{2,4}[\p{L}\p{N}_.$-]+\\{1,2}[^"'\r\n]*/gu, '…network path…')
			.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
			.replace(/(?<![\w:])(?:(?:[0-9a-f]{1,4}:){5,7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?)(?![\w:])/gi, '[ip]')
			// Also a UUID the stored sample was cut in the middle of
			.replace(/(?<![0-9a-f])([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f-]*/gi, '$1…')
			.replace(/(?<![0-9a-z])([0-9a-f]{8})[0-9a-f]{24,}(?![0-9a-z])/gi, '$1…')
			.replace(/("(?!bundleId"|requestId")(?:id|[a-zA-Z_]*(?:Id|_id))"\s*:\s*"(?!eg_)[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+(?="|$)/g, '$1…')
	);
}

/** Scrubbed, then cut to `max` characters. */
export function clip(value: unknown, max: number): string {
	return scrub(String(value ?? '')).slice(0, max);
}
