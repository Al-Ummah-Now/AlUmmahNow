/**
 * Whether an admin froze a record: a suspended channel or a banned owner puts
 * a suspension hold on it (shared-types applySuspensionHold). Endpoints that
 * change such records check this themselves, so the freeze does not depend on
 * which headers a request carries.
 */
export function hasSuspensionHolds(record: Record<string, unknown> | null | undefined): boolean {
	return Array.isArray(record?.suspensionHolds) && (record!.suspensionHolds as unknown[]).length > 0;
}

/** A live stream that is held, or whose channel is suspended or deleted (in case a cascade has not reached it). */
export async function liveStreamIsFrozen(env: { channels?: R2Bucket }, stream: Record<string, unknown>): Promise<boolean> {
	if (hasSuspensionHolds(stream)) return true;
	const channelId = typeof stream.channelId === 'string' ? stream.channelId : null;
	if (!channelId || !env.channels) return false;
	const object = await env.channels.get(channelId);
	if (!object) return false;
	const channel = (await object.json().catch(() => null)) as { isSuspended?: boolean; isDeleted?: boolean } | null;
	return channel?.isSuspended === true || channel?.isDeleted === true;
}
