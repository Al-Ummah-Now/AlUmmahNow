/**
 * Writing fields of the video JSON (`videos/<id>`) safely.
 *
 * The video JSON has many writers at once: viewers' comments and likes, the
 * view counter's flushes, the owner's edits, upload and processing status.
 * A blind get → put drops whatever another writer stored in between
 * (docs/architecture/SCALABILITY-AUDIT.md, AV-2/AV-3), so every writer
 * applies its change to the fresh object with a conditional write
 * (`R2Repository.updateObject`).
 */
import R2Repository from './r2Repo';

export type VideoPatchResult<V> =
	| { status: 'ok'; video: V; previous: V; changed: boolean }
	| { status: 'missing' }
	| { status: 'forbidden' };

/**
 * Applies `patch` (fields, or a function of the fresh video returning the
 * fields, or false for "nothing to change") to the stored video.
 *
 * With `ownerId`, the write only happens when the stored video still belongs
 * to that user. A missing video is never re-created (a delete wins).
 */
export async function patchVideo<V extends { userId?: string }>(
	repository: R2Repository<V>,
	videoId: string,
	patch: Partial<V> | ((fresh: V) => Partial<V> | false),
	opts: { ownerId?: string } = {},
): Promise<VideoPatchResult<V>> {
	let previous = undefined as V | undefined;
	let changed = false;
	const { data, rejected } = await repository.updateObjectOrReject<'forbidden'>(videoId, (fresh) => {
		changed = false;
		if (opts.ownerId !== undefined && fresh.userId !== opts.ownerId) return { reject: 'forbidden' };
		previous = { ...fresh };
		const fields = typeof patch === 'function' ? patch(fresh) : patch;
		if (fields === false) return false;
		Object.assign(fresh, fields);
		changed = true;
		return true;
	});
	if (!data) return { status: 'missing' };
	if (rejected) return { status: 'forbidden' };
	return { status: 'ok', video: data, previous: previous ?? data, changed };
}
