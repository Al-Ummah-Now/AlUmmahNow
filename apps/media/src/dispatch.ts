/**
 * The queue consumer's gate before a transcode starts: the admin's concurrent transcodes range,
 * autoscaled (slot-state.ts). A job with no free slot waits: its message is sent again in SLOT_WAIT_SECONDS and
 * this delivery is acked, so waiting never uses up the job's deliveries (START_MAX_DELIVERIES) and
 * never ends in the DLQ.
 */
import type { TranscodeJobMessage } from '@al-ummah/shared-types';
import { errorText, log, type Env } from './env';
import { readTranscodeLimit, SLOT_WAIT_SECONDS, slotsOf, type SlotAnswer } from './slot-state';

type GateEnv = Pick<Env, 'TRANSCODE_SLOTS' | 'TRANSCODE_QUEUE' | 'GLOBAL_SETTINGS' | 'MEDIA_TRANSCODE_CEILING'>;

/** True: start the job now. False: it waits for a slot (the message is handled). */
export async function gateTranscode(msg: Message<TranscodeJobMessage>, env: GateEnv): Promise<boolean> {
	const job = msg.body;
	let answer: SlotAnswer;
	try {
		const range = await readTranscodeLimit(env);
		answer = await slotsOf(env).acquire(job.videoId, job.jobId, range);
	} catch (error) {
		// Slots unreachable: start anyway; the container's max_instances still bounds spend
		log.warn('[MediaSlots] Could not take a slot; starting under the ceiling only', { videoId: job.videoId, jobId: job.jobId, error: errorText(error) });
		return true;
	}
	if (answer.granted) return true;
	try {
		if (!env.TRANSCODE_QUEUE) throw new Error('TRANSCODE_QUEUE is not bound');
		await env.TRANSCODE_QUEUE.send(job, { delaySeconds: SLOT_WAIT_SECONDS });
		msg.ack();
	} catch (error) {
		// Could not send it again: let the queue redeliver this one (uses a delivery, never lost)
		log.warn('[MediaSlots] Could not requeue a waiting job; retrying the delivery', { videoId: job.videoId, jobId: job.jobId, error: errorText(error) });
		msg.retry({ delaySeconds: SLOT_WAIT_SECONDS });
	}
	return false;
}
