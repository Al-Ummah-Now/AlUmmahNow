#!/usr/bin/env node
/**
 * Read-only impact report for the Free plan limits (Epic 27). Runs SELECTs and
 * R2 GETs through wrangler and prints aggregates only: no ids, names or emails.
 *
 * Usage (from a directory where `pnpm wrangler` works, e.g. apps/api-videos):
 *   node scripts/entitlements/impact-report.mjs <cwd> [d1-name] [channels-bucket] [videos-bucket]
 *
 * A figure is `null` when the stored data cannot answer it. Null is not zero.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [cwd, d1 = 'al-ummah-now-search', channelsBucket = 'channels', videosBucket = 'videos'] = process.argv.slice(2);
if (!cwd) throw new Error('Pass the directory to run wrangler from');

const wrangler = (args) => run('pnpm', ['-s', 'wrangler', ...args], { cwd, maxBuffer: 5e7 });
const sql = async (q) => JSON.parse((await wrangler(['d1', 'execute', d1, '--remote', '--json', '--command', q])).stdout)[0].results;

const failures = { channels: 0, videos: 0 };
async function read(bucket, kind, id) {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			return JSON.parse((await wrangler(['r2', 'object', 'get', `${bucket}/${id}`, '--remote', '--pipe'])).stdout);
		} catch {
			/* retry */
		}
	}
	failures[kind]++;
	return null;
}
async function readAll(ids, bucket, kind, parallel = 10) {
	const out = [];
	let next = 0;
	await Promise.all(Array.from({ length: parallel }, async () => {
		while (next < ids.length) {
			const object = await read(bucket, kind, ids[next++]);
			if (object) out.push(object);
		}
	}));
	return out;
}
const countBy = (items, key) => {
	const map = new Map();
	for (const item of items) {
		const k = key(item);
		if (k != null) map.set(k, (map.get(k) ?? 0) + 1);
	}
	return map;
};

const channelIds = [...new Set([...(await sql("SELECT id FROM content_ownership WHERE kind='channel'")), ...(await sql('SELECT id FROM search_channels'))].map((r) => r.id))];
const videoIds = (await sql("SELECT id FROM content_ownership WHERE kind='video'")).map((r) => r.id);
const channels = (await readAll(channelIds, channelsBucket, 'channels')).filter((c) => !c.isDeleted);
const videos = (await readAll(videoIds, videosBucket, 'videos')).filter((v) => !v.isDeleted);

const channelOwner = new Map(channels.map((c) => [c.id, c.userId]));
const owner = (v) => v.userId || channelOwner.get(v.channelId) || null;
const now = new Date();
const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
const created = (v) => Date.parse(v.dateCreated ?? v.createdAt ?? '');
const dated = videos.filter((v) => Number.isFinite(created(v)));
const thisMonth = dated.filter((v) => created(v) >= monthStart);
const withDuration = videos.filter((v) => Number(v.duration) > 0);
const withSize = videos.filter((v) => Number(v.fileSize) > 0);
const long = withDuration.filter((v) => Number(v.duration) > 1800);
const bytes = new Map();
for (const v of withSize) {
	const o = owner(v);
	if (o) bytes.set(o, (bytes.get(o) ?? 0) + Number(v.fileSize));
}
const complete = (subset) => subset.length === videos.length;
const overLinks = channels.filter((c) => (c.links ?? []).length > 5);

console.log(JSON.stringify({
	scanned: { channelIds: channelIds.length, videoIds: videoIds.length, liveChannels: channels.length, liveVideos: videos.length, readFailures: failures },
	usersOver1Channel: [...countBy(channels, (c) => c.userId).values()].filter((n) => n > 1).length,
	channelOwners: new Set(channels.map((c) => c.userId)).size,
	channelsOver5Links: overLinks.length,
	usersWithChannelOver5Links: new Set(overLinks.map((c) => c.userId)).size,
	usersOver10UploadsThisMonth: complete(dated) ? [...countBy(thisMonth, owner).values()].filter((n) => n > 10).length : null,
	uploadsThisMonth: complete(dated) ? thisMonth.length : null,
	usersOver5GB: complete(withSize) ? [...bytes.values()].filter((n) => n > 5e9).length : null,
	videosOver30Min: complete(withDuration) ? long.length : null,
	usersWithVideoOver30Min: complete(withDuration) ? new Set(long.map(owner).filter(Boolean)).size : null,
	coverage: { videosWithDate: dated.length, videosWithDuration: withDuration.length, videosWithFileSize: withSize.length },
}, null, 1));
