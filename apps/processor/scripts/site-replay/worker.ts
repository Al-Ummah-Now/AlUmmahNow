/**
 * Runner of the site counter replay (#1477, src/lib/site-replay.ts), served by `wrangler dev --remote`
 * from a generated config that binds only the archive bucket and the notifications D1 (run.mjs).
 * Nothing is deployed. GET /?cutoff=<ISO>[&from=YYYY-MM-DD][&apply=1] answers the report as JSON;
 * apply needs REPLAY_ALLOW_APPLY=1, which run.mjs sets only with --apply.
 */
import { replaySiteCounters, type ArchiveBucket } from '../../src/lib/site-replay';
import type { D1Database } from '../../src/types';

interface Env {
	MESSAGES_BUCKET: ArchiveBucket;
	NOTIFICATIONS_DB: D1Database;
	REPLAY_ALLOW_APPLY?: string;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== '/') return new Response('not found', { status: 404 });
		const apply = url.searchParams.get('apply') === '1';
		if (apply && env.REPLAY_ALLOW_APPLY !== '1') return Response.json({ error: 'apply_not_allowed' }, { status: 403 });
		const cutoff = url.searchParams.get('cutoff');
		if (!cutoff) return Response.json({ error: 'cutoff_required' }, { status: 400 });
		try {
			const report = await replaySiteCounters(env, { cutoff, from: url.searchParams.get('from') ?? undefined, apply });
			return Response.json(report);
		} catch (error) {
			return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
		}
	},
};
