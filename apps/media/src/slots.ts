/** The TranscodeSlots Durable Object (rules and state in slot-state.ts). */
import { DurableObject } from 'cloudflare:workers';
import { acquireSlot, emptySlots, pruneSlots, releaseSlot, renewSlot, type SlotAnswer, type SlotState } from './slot-state';
import type { TranscodeRange } from '@al-ummah/shared-types';
import type { Env } from './env';

export class TranscodeSlots extends DurableObject<Env> {
	private async load(): Promise<SlotState> {
		return (await this.ctx.storage.get<SlotState>('slots')) ?? emptySlots();
	}

	async acquire(videoId: string, jobId: string, range: TranscodeRange): Promise<SlotAnswer> {
		const { state, answer } = acquireSlot(await this.load(), videoId, jobId, range, Date.now());
		await this.ctx.storage.put('slots', state);
		return answer;
	}

	async renew(videoId: string, jobId: string, until: number): Promise<void> {
		await this.ctx.storage.put('slots', renewSlot(await this.load(), videoId, jobId, until, Date.now()));
	}

	async release(videoId: string, jobId: string): Promise<void> {
		await this.ctx.storage.put('slots', releaseSlot(await this.load(), videoId, jobId, Date.now()));
	}

	/** Slots in use and jobs waiting (diagnostics). */
	async snapshot(): Promise<{ inUse: number; waiting: number; allowed: number }> {
		const state = pruneSlots(await this.load(), Date.now());
		return { inUse: Object.keys(state.leases).length, waiting: Object.keys(state.waiters).length, allowed: state.allowed };
	}
}

