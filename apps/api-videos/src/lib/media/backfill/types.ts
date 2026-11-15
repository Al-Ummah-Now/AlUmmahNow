import type { ErrorReporterEnv, ExecutionContextLike } from '@al-ummah/shared-types';
import type { BunnyLibrariesEnv } from '../../bunny/libraries';
import type { MediaEnv } from '../r2-delivery';

export type BackfillEnv = MediaEnv &
	BunnyLibrariesEnv &
	ErrorReporterEnv & {
		MEDIA_ORIGINALS?: R2Bucket;
		/** Max concurrent transcodes (apps/media max_instances) */
		MEDIA_MAX_TRANSCODES?: string;
		image_storage_key?: unknown;
		ZONE?: string;
	};

export type Ctx = ExecutionContextLike | undefined;

export const BACKFILL_KIND = 'media-backfill';

export type BackfillOp = 'estimate' | 'tick' | 'copy' | 'verify' | 'removal';

export interface BackfillMessage {
	kind: typeof BACKFILL_KIND;
	op: BackfillOp;
	runId?: string;
	videoId?: string;
	/** copy: the byte offset to continue from */
	offset?: number;
}

const SAFE = /^[A-Za-z0-9-]{8,64}$/;

export function isBackfillMessage(body: unknown): body is BackfillMessage {
	const m = body as Partial<BackfillMessage> | null;
	if (!m || m.kind !== BACKFILL_KIND) return false;
	if (!['estimate', 'tick', 'copy', 'verify', 'removal'].includes(m.op as string)) return false;
	if (m.runId !== undefined && !SAFE.test(m.runId)) return false;
	if (m.videoId !== undefined && !SAFE.test(m.videoId)) return false;
	return true;
}

/** Queue deliveries of one message: 1 + max_retries (processing-check queue: 5). The last one dead-letters. */
export const BACKFILL_MAX_DELIVERIES = 6;
