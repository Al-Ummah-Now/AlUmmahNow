/**
 * Order of a channel's sections, kept in ONE document per channel
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-20).
 *
 * Sections used to carry their own `position`, and create / delete / reorder
 * rewrote the positions of many section objects without conditions: two
 * creates at once took the same position, a delete racing a reorder left
 * gaps and duplicates. Now the order is a list of section ids in
 * `_order/<channelId>` (same bucket, outside the `<channelId>/` prefix that
 * lists the sections), changed only with a conditional write.
 *
 * Channels without an order document (sections created before this change)
 * are ordered by their stored `position`; the first create / delete /
 * reorder seeds the document from that order. Readers always report a
 * section's `position` as its index in the resolved order.
 */
import R2Repository from './r2Repo';

export interface SectionOrder {
	channelId: string;
	sectionIds: string[];
	dateModified: string;
}

interface Positioned {
	id: string;
	position?: number;
}

export const sectionOrderKey = (channelId: string) => `_order/${channelId}`;

/** Legacy order: by stored position, then id (stable). */
function byPosition<S extends Positioned>(sections: S[]): S[] {
	return [...sections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Sorts `sections` by the channel's order (ids not in the order, e.g. created
 * by a write that is still finishing, come last by position) and sets each
 * `position` to its index. Ids in the order without a section are ignored.
 */
export function applySectionOrder<S extends Positioned>(sections: S[], order: SectionOrder | null): S[] {
	const index = new Map((order?.sectionIds ?? []).map((id, i) => [id, i]));
	const known = sections.filter((s) => index.has(s.id)).sort((a, b) => index.get(a.id)! - index.get(b.id)!);
	const rest = byPosition(sections.filter((s) => !index.has(s.id)));
	return [...known, ...rest].map((s, i) => ({ ...s, position: i }));
}

export async function readSectionOrder(bucket: R2Bucket, channelId: string): Promise<SectionOrder | null> {
	return new R2Repository<SectionOrder>(bucket).getObject(sectionOrderKey(channelId));
}

/** All sections of a channel (one list page of up to 1000, like before), unordered. */
export async function listChannelSections<S extends Positioned>(bucket: R2Bucket, channelId: string): Promise<S[]> {
	const listed = await bucket.list({ prefix: `${channelId}/`, limit: 1000 });
	const repo = new R2Repository<S>(bucket);
	const sections = await Promise.all(listed.objects.map((obj) => repo.getObject(obj.key)));
	return sections.filter((s) => s !== null) as S[];
}

/**
 * Changes the order with a conditional write. `mutate` gets the fresh id list
 * and returns the new list, `{ reject }` to stop, or false for no change. A
 * channel without an order document yet is seeded from the stored positions
 * of its sections (create-only, so concurrent seeds agree on one document).
 */
export async function changeSectionOrder<E>(
	bucket: R2Bucket,
	channelId: string,
	mutate: (sectionIds: string[]) => string[] | { reject: E } | false,
): Promise<{ order: SectionOrder | null; rejected?: E }> {
	const repo = new R2Repository<SectionOrder>(bucket);
	let seed: string[] | undefined;
	if (!(await readSectionOrder(bucket, channelId))) {
		seed = byPosition(await listChannelSections<Positioned>(bucket, channelId)).map((s) => s.id);
	}
	const { data, rejected } = await repo.updateObjectOrReject<E>(
		sectionOrderKey(channelId),
		(fresh) => {
			const next = mutate([...(fresh.sectionIds ?? [])]);
			if (next === false) return false;
			if (!Array.isArray(next)) return next;
			fresh.sectionIds = next;
			fresh.dateModified = new Date().toISOString();
			return true;
		},
		{ initial: () => ({ channelId, sectionIds: [...(seed ?? [])], dateModified: new Date().toISOString() }) },
	);
	return { order: data, rejected };
}

/** `section` with its `position` resolved from the channel's order (at most 5 sections per channel). */
export async function withResolvedPosition<S extends Positioned>(bucket: R2Bucket, channelId: string, section: S): Promise<S> {
	const [sections, order] = await Promise.all([listChannelSections<Positioned>(bucket, channelId), readSectionOrder(bucket, channelId)]);
	const resolved = applySectionOrder(sections, order).find((s) => s.id === section.id);
	return resolved ? { ...section, position: resolved.position } : section;
}
