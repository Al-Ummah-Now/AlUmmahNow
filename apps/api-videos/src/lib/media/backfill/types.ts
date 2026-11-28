import type { ErrorReporterEnv, ExecutionContextLike } from '@al-ummah/shared-types';
import { z } from 'zod';
import { RecordId } from '../../../validation/identifiers';
import type { BunnyLibrariesEnv } from '../../bunny/libraries';
import type { MediaEnv } from '../r2-delivery';

export type BackfillEnv = MediaEnv &
	BunnyLibrariesEnv &
	ErrorReporterEnv & {
		MEDIA_ORIGINALS?: R2Bucket;
		/** Ceiling of the admin's max concurrent transcodes (apps/media max_instances); the setting is in global_settings */
		MEDIA_TRANSCODE_CEILING?: string;
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

const BackfillBody = z.object({
	kind: z.literal(BACKFILL_KIND),
	runId: RecordId.min(8).max(64).optional(), videoId: RecordId.min(8).max(64).optional(),
	op: z.enum(['estimate', 'tick', 'copy', 'verify', 'removal']), offset: z.number().int().nonnegative().optional(),
});

export function isBackfillMessage(body: unknown): body is BackfillMessage {
	return BackfillBody.safeParse(body).success;
}

/** Queue deliveries of one message: 1 + max_retries (processing-check queue: 5). The last one dead-letters. */
export const BACKFILL_MAX_DELIVERIES = 6;
