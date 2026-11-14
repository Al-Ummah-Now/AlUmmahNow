/**
 * Every public hostname of the env must be attached (as a Workers custom domain)
 * to the env's own worker before the release checks which version answers.
 *
 * Why: `wrangler deploy --name <preview>` with a config that declares a custom
 * domain silently moves that domain to the preview worker. On 2026-11-09 a PR
 * preview took admin.api.alummahnow.net this way, prod traffic was served by the
 * PR build, and the release's 0% check failed (it reads /health on that host).
 * The release re-attaches any hostname owned by the wrong worker, so the fix goes
 * through CI instead of by hand.
 */
import { CfApiError, type CfClient } from './cf-api.ts';
import { HOSTS, WORKERS, type Hosts } from './smoke.ts';

/** Which app serves each public host. */
export const HOST_APP: Record<keyof Hosts, string> = {
	web: 'web',
	api: 'api-videos',
	realtime: 'websocket-server',
	adminWeb: 'admin-web',
	adminApi: 'admin-api',
};

/**
 * Hosts the release itself attaches when no worker has them (the others are
 * attached by `triggers deploy` from config or in the dashboard). Production
 * config declares no routes (a preview deploy with routes moves them, see the
 * 2026-11-09 note above), so its live edge host is attached here:
 * live.alummahnow.net was never attached, so prod self-hosted live had no
 * ingest or playback host (Studio showed encoder settings for a host that did
 * not answer).
 */
export const RELEASE_ATTACHED_HOSTS: Record<'stage' | 'production', Record<string, string>> = {
	production: { 'live.alummahnow.net': 'api-videos' },
	stage: { 'live.stage.alummahnow.net': 'api-videos' },
};

/** hostname -> worker, for the hosts served by `apps` in `env`. */
export function expectedDomains(env: 'stage' | 'production', apps: string[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, app] of Object.entries(HOST_APP) as [keyof Hosts, string][]) {
		if (!apps.includes(app)) continue;
		out[new URL(HOSTS[env][key]).hostname] = WORKERS[env][app];
	}
	for (const [hostname, app] of Object.entries(RELEASE_ATTACHED_HOSTS[env])) {
		if (apps.includes(app)) out[hostname] = WORKERS[env][app];
	}
	return out;
}

/** The release-attached hostnames of `env` (attached when missing, not only re-attached). */
export const attachWhenMissing = (env: 'stage' | 'production') => Object.keys(RELEASE_ATTACHED_HOSTS[env]);

/** The zone of a hostname, from an attached sibling in the same apex (no zone read permission needed). */
function siblingZone(records: DomainRecord[], hostname: string): string | null {
	const apex = hostname.split('.').slice(-2).join('.');
	return records.find((r) => r.hostname === apex || r.hostname.endsWith(`.${apex}`))?.zone_id ?? null;
}

export interface DomainRecord {
	id: string;
	hostname: string;
	service: string;
	zone_id: string;
	environment?: string;
}

type Cf = Pick<CfClient, 'request'>;

const attach = (cf: Cf, rec: DomainRecord, service: string) =>
	cf.request('PUT', '/workers/domains', { hostname: rec.hostname, service, environment: 'production', zone_id: rec.zone_id });

/**
 * Re-attaches each expected hostname that another worker owns. A hostname that is
 * not attached at all is left alone (step 3's `triggers deploy` attaches the ones
 * declared in config; the rest are attached in the dashboard).
 * Returns the hostnames it moved.
 */
export async function ensureCustomDomains(cf: Cf, expected: Record<string, string>, log: (line: string) => void, attachMissing: readonly string[] = []): Promise<string[]> {
	const records = await cf.request<DomainRecord[]>('GET', '/workers/domains?per_page=500');
	const moved: string[] = [];
	for (const [hostname, worker] of Object.entries(expected)) {
		const rec = records.find((r) => r.hostname === hostname);
		if (!rec) {
			const zone = attachMissing.includes(hostname) ? siblingZone(records, hostname) : null;
			if (!zone) {
				log(`${hostname}: not attached to any worker (left to triggers deploy / the dashboard)`);
				continue;
			}
			log(`${hostname}: not attached; attaching to ${worker}`);
			await attach(cf, { id: '', hostname, service: worker, zone_id: zone }, worker);
			moved.push(hostname);
			continue;
		}
		if (rec.service === worker) continue;
		log(`${hostname}: attached to ${rec.service}, expected ${worker}; re-attaching`);
		try {
			await attach(cf, rec, worker);
		} catch (error) {
			if (!(error instanceof CfApiError)) throw error;
			// The API refused to move an attached hostname: detach it, then attach (a few seconds without a handler)
			await cf.request('DELETE', `/workers/domains/${rec.id}`);
			await attach(cf, rec, worker);
		}
		moved.push(hostname);
	}
	if (moved.length) {
		const after = await cf.request<DomainRecord[]>('GET', '/workers/domains?per_page=500');
		const wrong = moved.filter((h) => after.find((r) => r.hostname === h)?.service !== expected[h]);
		if (wrong.length) throw new Error(`custom domains still on the wrong worker after re-attaching: ${wrong.join(', ')}`);
	}
	return moved;
}
