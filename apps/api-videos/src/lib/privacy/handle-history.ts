/**
 * An erased channel's old handles (handle history, lib/channelHandles.ts) stop redirecting to it and
 * stop being held: each history entry that is still the channel's goes, with the channel's markers.
 * The budgeted twin of dropHandleHistory, shared by every erase path.
 */
import { BucketLike, OperationBudget, deleteKeys, readJson } from './scan';

const HISTORY_PREFIX = 'channel-handle-history/';
const MARKER_PREFIX = 'channel-handle-history-of/';

export async function eraseChannelHandleHistory(tabs: BucketLike, channelId: string, budget: OperationBudget): Promise<number> {
	const prefix = `${MARKER_PREFIX}${channelId}/`;
	const markers: string[] = [];
	let cursor: string | undefined;
	do {
		budget.spend();
		const page = await tabs.list({ prefix, cursor, limit: 1000 });
		markers.push(...page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	let dropped = 0;
	for (const marker of markers) {
		const historyKey = `${HISTORY_PREFIX}${marker.slice(prefix.length)}`;
		const history = await readJson<{ channelId?: string }>(tabs, historyKey, budget);
		if (history?.channelId === channelId) dropped += await deleteKeys(tabs, [historyKey], budget);
	}
	await deleteKeys(tabs, markers, budget);
	return dropped;
}
