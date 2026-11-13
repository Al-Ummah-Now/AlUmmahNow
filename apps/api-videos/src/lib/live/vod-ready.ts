/**
 * "The recording is ready" hook: self-hosted finalize and the Bunny VOD poll call it once per
 * session; lib/live/streams.ts wires it to the post-hoc review of the recording (VR9). A failing
 * listener never breaks ending a stream.
 */
import { logger } from '../logger';
import type { LiveEnv } from './providers';
import type { LiveSessionRow } from './store';

type Listener = (env: LiveEnv, session: LiveSessionRow) => Promise<void>;
let listener: Listener | null = null;

export function setOnVodReady(fn: Listener | null): void {
	listener = fn;
}

export async function vodReady(env: LiveEnv, session: LiveSessionRow): Promise<void> {
	if (!listener) return;
	try {
		await listener(env, session);
	} catch (error) {
		logger.error('[Live] The recording-ready hook failed', { sessionId: session.id, error: error instanceof Error ? error.message : String(error) });
	}
}
