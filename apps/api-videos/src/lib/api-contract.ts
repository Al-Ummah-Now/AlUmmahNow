/**
 * The public API contract (Epic 9.3): the OpenAPI document that native SDKs
 * (`aun-core`'s `aun-api`) are generated from.
 *
 * Built from chanfana's document for the real routers, then:
 * - router paths are corrected: chanfana documents `mount + base + path`
 *   while Hono serves `mount + path` (every router is created with a `base`
 *   equal to its mount), e.g. `/api/videos/api/videos/{id}` → `/api/videos/{id}`;
 * - only public `/api/...` routes are kept (internal, diagnostic and
 *   monitoring routes are not part of the contract);
 * - paths are prefixed with the version (`/api/v1/...`) and sorted, so the
 *   output is stable and diffs show contract changes.
 *
 * `openapi/v1.json` is generated from this (`pnpm openapi:generate`) and a unit
 * test fails when it drifts from the routes.
 */
import { CONTRACT_VERSION, CURRENT_API_VERSION, DEPRECATIONS } from './api-version';

/** Internal routes under /api/* that are guarded by X-API-Key, not part of the public contract. */
export const NON_CONTRACT_PATHS: readonly string[] = ['/api/i18n/sync'];

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** Collapse a duplicated leading prefix: `/a/b/a/b/c` → `/a/b/c`, `/api/api/x` → `/api/x`. */
export function normalizeDocPath(path: string): string {
	const match = /^((?:\/[^/]+)+?)\1(?=\/|$)/.exec(path);
	return match ? match[1] + path.slice(match[0].length) : path;
}

/** Route document paths (raw chanfana output) as served, without the version prefix. */
export function servedPaths(rawDoc: { paths?: Record<string, unknown> }): Record<string, any> {
	const out: Record<string, any> = {};
	for (const [path, item] of Object.entries(rawDoc.paths ?? {})) {
		const served = normalizeDocPath(path);
		out[served] = { ...(out[served] ?? {}), ...(item as object) };
	}
	return out;
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
	return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]])) as T;
}

export interface ContractOptions {
	version?: string;
	servers?: { url: string; description: string }[];
}

export const CONTRACT_SERVERS = [
	{ url: 'https://videos.api.alummahnow.net', description: 'Production' },
	{ url: 'https://videos.api.stage.alummahnow.net', description: 'Stage' },
	{ url: 'https://videos.api.qa.alummahnow.net', description: 'QA' },
];

export function buildContractDocument(rawDoc: any, options: ContractOptions = {}): any {
	const version = options.version ?? CURRENT_API_VERSION;
	const paths: Record<string, any> = {};
	for (const [path, item] of Object.entries(servedPaths(rawDoc))) {
		if (!path.startsWith('/api/') || NON_CONTRACT_PATHS.includes(path)) continue;
		const versioned = `/api/v${version}${path.slice('/api'.length)}`;
		const operations: Record<string, any> = {};
		for (const method of HTTP_METHODS) {
			const op = item[method];
			if (!op) continue;
			const deprecated = DEPRECATIONS[`${method.toUpperCase()} ${versioned}`];
			operations[method] = deprecated ? { ...op, deprecated: true } : op;
		}
		if (Object.keys(operations).length) paths[versioned] = operations;
	}

	const components = { ...(rawDoc.components ?? {}) };
	components.securitySchemes = {
		BearerAuth: {
			type: 'http',
			scheme: 'bearer',
			bearerFormat: 'JWT',
			description: 'Access token from the Al Ummah Now auth server (OAuth 2.0 + PKCE, or the device flow on TVs).',
		},
	};

	return {
		openapi: rawDoc.openapi ?? '3.1.0',
		info: {
			title: 'Al Ummah Now API',
			version: CONTRACT_VERSION,
			description:
				`Public API v${version} for Al Ummah Now apps. Additive changes ship in v${version}; breaking changes ship as a new version. ` +
				'Deprecated operations answer with Deprecation and Sunset headers. See API_VERSIONING.md.',
		},
		servers: options.servers ?? CONTRACT_SERVERS,
		security: [{ BearerAuth: [] }],
		paths: sortKeys(paths),
		components: sortKeys(components),
	};
}

/** Stable serialisation used for the checked-in file. */
export function serializeContract(doc: unknown): string {
	return `${JSON.stringify(doc, null, 2)}\n`;
}
