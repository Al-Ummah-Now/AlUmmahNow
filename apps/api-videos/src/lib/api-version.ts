/**
 * Public API versioning (Epic 9.3).
 *
 * Every public route answers under `/api/v1/...`. The worker rewrites
 * `/api/v1/<rest>` to `/api/<rest>` before routing, so one set of handlers
 * serves both; the unversioned `/api/...` path stays an alias of v1 for the
 * web apps. A breaking change ships new handlers under `/api/v2/...`.
 * See API_VERSIONING.md.
 */

export const CURRENT_API_VERSION = '1';
export const SUPPORTED_API_VERSIONS: readonly string[] = ['1'];
/** Version of the v1 contract document (openapi/v1.json). Bump the minor for additive changes. */
export const CONTRACT_VERSION = '1.1.0';

export const API_VERSION_HEADER = 'X-API-Version';

const VERSIONED_PATH = /^\/api\/v(\d+)(\/.*)?$/;

export type VersionedRequest =
	| { kind: 'unversioned'; request: Request }
	| { kind: 'versioned'; version: string; request: Request }
	| { kind: 'unsupported'; version: string };

/** Map `/api/v1/x` to `/api/x` (same method, headers and body). */
export function resolveApiVersion(request: Request): VersionedRequest {
	const url = new URL(request.url);
	const match = VERSIONED_PATH.exec(url.pathname);
	if (!match) return { kind: 'unversioned', request };
	const version = match[1];
	if (!SUPPORTED_API_VERSIONS.includes(version)) return { kind: 'unsupported', version };
	url.pathname = `/api${match[2] ?? ''}`;
	return { kind: 'versioned', version, request: new Request(url.toString(), request) };
}

export function unsupportedVersionResponse(version: string): Response {
	return new Response(
		JSON.stringify({
			success: false,
			error: 'unsupported_api_version',
			message: `API version v${version} is not supported. Supported versions: ${SUPPORTED_API_VERSIONS.map((v) => `v${v}`).join(', ')}.`,
			supported: SUPPORTED_API_VERSIONS,
		}),
		{ status: 404, headers: { 'Content-Type': 'application/json' } },
	);
}

/**
 * Deprecated operations: `"<METHOD> <path as in the contract>"` → dates.
 * Matching responses carry `Deprecation` (RFC 9745) and `Sunset` (RFC 8594)
 * headers, and the contract marks the operation `deprecated: true`.
 */
export interface Deprecation {
	/** When the operation was deprecated (ISO date). */
	since: string;
	/** Earliest date it may be removed (ISO date). */
	sunset: string;
	/** Replacement operation or doc link. */
	link?: string;
}
export const DEPRECATIONS: Record<string, Deprecation> = {
	// Owner decision 2026-11-11: dislikes are turned off; this always answers
	// 410 dislikes_disabled. Clearing an old dislike (DELETE) still works.
	'POST /api/v1/videos/{id}/dislikes': { since: '2026-11-11', sunset: '2027-05-11' },
};

/** RFC 9745 wants a structured-field date (`@<unix seconds>`); Sunset is an HTTP date. */
export function deprecationHeaders(d: Deprecation): Record<string, string> {
	const headers: Record<string, string> = {
		Deprecation: `@${Math.floor(Date.parse(d.since) / 1000)}`,
		Sunset: new Date(d.sunset).toUTCString(),
	};
	if (d.link) headers.Link = `<${d.link}>; rel="deprecation"`;
	return headers;
}

/** Find the deprecation entry for a concrete request path (`{param}` segments match any value). */
export function findDeprecation(method: string, path: string, table: Record<string, Deprecation> = DEPRECATIONS): Deprecation | undefined {
	const segments = path.split('/');
	for (const [key, value] of Object.entries(table)) {
		const [m, p] = key.split(' ');
		if (m !== method.toUpperCase()) continue;
		const pattern = p.replace(/^\/api\/v\d+/, '/api').split('/');
		if (pattern.length !== segments.length) continue;
		if (pattern.every((seg, i) => /^\{.+\}$/.test(seg) || seg === segments[i])) return value;
	}
	return undefined;
}
