/**
 * Whether a channel's owner authorized a source (wiki TOOLS-ADMIN TA-9, "Social import"): imports only
 * go into a channel whose owner connected the account themselves (Studio → Social connections, or the
 * YouTube import's Google consent), or whose written permission a super admin recorded (who, a note;
 * audited by admin-api). Telegram needs our bot in the channel, which only the owner's own connection
 * gives (SOC-1's one-time code), so a Telegram source is always a connected one.
 */
import type { ImportSourceConnection, ImportSourceNetwork } from '@al-ummah/shared-types';
import { sourceDb, SourceError, type SourceDbEnv } from './store';
import { checkUrl } from '../link-preview';

const BLUESKY_DID = /^did:(plc:[a-z2-7]{24}|web:[a-z0-9.-]+)$/;
const BLUESKY_HANDLE = /^@?([a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+)$/i;
const MASTODON_ACCT = /^@?([A-Za-z0-9_]{1,30})@([a-z0-9.-]+\.[a-z]{2,})$/i;
const TELEGRAM_CHAT = /^-?\d{5,20}$/;
const YOUTUBE_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * The address in its stored form, or a 400. Bluesky handles are resolved to the account's DID by the
 * caller (resolveBlueskyAddress), so a renamed handle keeps importing.
 */
export function normalizeAddress(network: ImportSourceNetwork, raw: string): string {
	const value = raw.trim();
	switch (network) {
		case 'rss': {
			try {
				return checkUrl(value).toString();
			} catch {
				throw new SourceError(400, 'invalid_address', 'A public http(s) feed URL is required');
			}
		}
		case 'bluesky': {
			if (BLUESKY_DID.test(value)) return value;
			const m = value.match(BLUESKY_HANDLE);
			if (m) return m[1]!.toLowerCase();
			throw new SourceError(400, 'invalid_address', 'A Bluesky handle (name.bsky.social) or DID is required');
		}
		case 'mastodon': {
			const m = value.match(MASTODON_ACCT);
			if (!m) throw new SourceError(400, 'invalid_address', 'A Mastodon account (@name@instance) is required');
			return `${m[1]}@${m[2]!.toLowerCase()}`;
		}
		case 'telegram': {
			if (!TELEGRAM_CHAT.test(value)) throw new SourceError(400, 'invalid_address', 'A Telegram chat id is required');
			return value;
		}
		case 'youtube': {
			if (!YOUTUBE_CHANNEL.test(value)) throw new SourceError(400, 'invalid_address', 'A YouTube channel id (UC…) is required');
			return value;
		}
	}
}

interface SocialAccountLite {
	id: string;
	network: string;
	remote_id: string;
	handle: string;
	display_name: string;
	instance: string | null;
}

const host = (instance: string | null) => {
	if (!instance) return '';
	try {
		return new URL(instance.includes('://') ? instance : `https://${instance}`).hostname.toLowerCase();
	} catch {
		return instance.toLowerCase();
	}
};

/** The address a connected account gives each network. */
function accountAddress(a: SocialAccountLite): string | null {
	if (a.network === 'bluesky') return a.remote_id;
	if (a.network === 'telegram') return a.remote_id;
	if (a.network === 'mastodon') {
		const user = a.handle.replace(/^@/, '').split('@')[0];
		const h = host(a.instance);
		return user && h ? `${user}@${h}` : null;
	}
	return null;
}

/** Everything the channel's owner connected that can be imported from. */
export async function channelConnections(env: SourceDbEnv, channelId: string): Promise<ImportSourceConnection[]> {
	const db = sourceDb(env);
	const out: ImportSourceConnection[] = [];
	const { results: accounts } = await db
		.prepare(`SELECT id, network, remote_id, handle, display_name, instance FROM social_accounts WHERE channel_id = ? AND status = 'active' AND network IN ('bluesky', 'mastodon', 'telegram')`)
		.bind(channelId)
		.all<SocialAccountLite>();
	for (const a of accounts ?? []) {
		const address = accountAddress(a);
		if (address) out.push({ network: a.network as ImportSourceNetwork, address, label: a.display_name || a.handle || address, socialAccountId: a.id, ytImportId: null });
	}
	const { results: yts } = await db
		.prepare(`SELECT id, yt_channel_json FROM yt_imports WHERE channel_id = ? AND yt_channel_json IS NOT NULL ORDER BY created_at DESC`)
		.bind(channelId)
		.all<{ id: string; yt_channel_json: string }>();
	const seen = new Set<string>();
	for (const y of yts ?? []) {
		try {
			const ch = JSON.parse(y.yt_channel_json) as { id?: string; title?: string };
			if (ch.id && YOUTUBE_CHANNEL.test(ch.id) && !seen.has(ch.id)) {
				seen.add(ch.id);
				out.push({ network: 'youtube', address: ch.id, label: ch.title || ch.id, socialAccountId: null, ytImportId: y.id });
			}
		} catch {
			// A snapshot that is not JSON is not a connection
		}
	}
	return out;
}

export interface Authorization {
	auth: 'connected' | 'recorded';
	socialAccountId: string | null;
	ytImportId: string | null;
	permission: { by: string; note: string } | null;
	label: string | null;
}

/**
 * Decides how the source is authorized: the owner's own connection when there is one for that address,
 * else the recorded permission (refused for Telegram, and when none is given).
 */
export async function authorizeSource(
	env: SourceDbEnv,
	input: { channelId: string; network: ImportSourceNetwork; address: string; permission?: { by?: string; note?: string } | null },
): Promise<Authorization> {
	const connection = (await channelConnections(env, input.channelId)).find((c) => c.network === input.network && c.address === input.address);
	if (connection) return { auth: 'connected', socialAccountId: connection.socialAccountId, ytImportId: connection.ytImportId, permission: null, label: connection.label };
	if (input.network === 'telegram') throw new SourceError(403, 'not_connected', 'Telegram channels are imported only once the owner connected them in Studio (our bot reads the posts)');
	const by = input.permission?.by?.trim();
	const note = input.permission?.note?.trim();
	if (!by || !note) throw new SourceError(403, 'permission_required', "The owner hasn't connected this account: record whose written permission you have, and a note");
	return { auth: 'recorded', socialAccountId: null, ytImportId: null, permission: { by: by.slice(0, 200), note: note.slice(0, 1000) }, label: null };
}
