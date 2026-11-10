/**
 * Idempotent upload initiate: one Bunny placeholder per file, however many
 * times the upload is retried (owner, 2026-11-10: every retry created a new
 * Bunny video and the old ones stayed forever).
 *
 * The client sends a file fingerprint (name, size, lastModified and a SHA-256
 * of the first and last MiB). The server keys a claim on channel + uploader +
 * fingerprint in R2 (`global_settings`, ops/upload-fingerprints/<key>.json):
 *
 *   no claim                 → create-only put {creating}, create the video, bind it
 *   bound, video unfinished  → reuse it (any browser, any tab, storage cleared)
 *   bound, finished/deleted  → take the claim over (etag-conditional put), create a new one
 *   creating, lease live     → another request is creating it: wait, then reuse
 *   creating, lease expired  → its creator died: take over, create
 *
 * Every claim write is conditional (create-only or etag match), so two
 * concurrent initiates of the same file produce exactly one Bunny video. A
 * creator that dies after Bunny created the video but before binding leaves a
 * Bunny video without a record: the reaper's orphan sweep removes it.
 *
 * Pure orchestration over injected I/O so the race and the state machine are
 * unit tested (test/upload-idempotent-initiate.spec.ts).
 */

import { z } from 'zod';
import { logger } from '../logger';

export const UPLOAD_FINGERPRINT_PREFIX = 'ops/upload-fingerprints/';

/** How long a `creating` claim is honoured before another request may take it over. */
export const CLAIM_LEASE_MS = 60_000;

/** How long an initiate waits for a concurrent request that is creating the same file's video. */
export const CLAIM_WAIT_MS = 15_000;

/** The client's file fingerprint (web: apps/web/src/lib/upload/fingerprint.ts). */
export const UploadFingerprintSchema = z.object({
	name: z.string().min(1).max(512),
	size: z.number().int().positive(),
	lastModified: z.number().int().nonnegative(),
	/** SHA-256 (hex) of the first and last MiB of the file */
	hash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type UploadFingerprint = z.infer<typeof UploadFingerprintSchema>;

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Claim key for channel + uploader + file. Stable across browsers for the same file. */
export async function fingerprintKey(channelId: string, userId: string, fp: UploadFingerprint): Promise<string> {
	return sha256Hex(JSON.stringify([channelId, userId, fp.name, fp.size, fp.lastModified, fp.hash]));
}

export function claimObjectKey(key: string): string {
	return `${UPLOAD_FINGERPRINT_PREFIX}${key}.json`;
}

export interface FingerprintClaim {
	key: string;
	state: 'creating' | 'bound';
	videoId?: string;
	/** Random id of the request holding a `creating` claim */
	owner: string;
	userId: string;
	channelId: string;
	leaseUntil: number;
	createdAt: string;
	updatedAt: string;
	/** Earlier videos this claim pointed at (finished or deleted), newest last */
	previous?: string[];
}

/** Minimal R2 surface (a MemoryBucket in tests). */
export interface ClaimStore {
	get(key: string): Promise<{ etag: string; json<T>(): Promise<T> } | null>;
	put(key: string, value: string, options?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }; httpMetadata?: unknown }): Promise<{ etag: string } | null>;
	delete(key: string): Promise<void>;
}

export type ReuseVerdict = { kind: 'reuse' } | { kind: 'replace'; why: string };

export interface InitiateOnceDeps {
	store: ClaimStore;
	userId: string;
	channelId: string;
	/** Can the bound video take this upload again? Throws on a transient failure. */
	check(videoId: string): Promise<ReuseVerdict>;
	/** Create the Bunny video and its record; resolves to the video id. */
	create(): Promise<string>;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
	waitMs?: number;
}

export interface InitiateOnceResult {
	videoId: string;
	reused: boolean;
	/** Why the previously bound video was not reused (new video created) */
	replaced?: string;
}

/** Another request is still creating this file's video: the client retries shortly. */
export class UploadClaimBusyError extends Error {
	readonly status = 503;
	constructor(readonly key: string) {
		super('Another upload of this file is starting, retry');
		this.name = 'UploadClaimBusyError';
	}
}

const JSON_META = { contentType: 'application/json' };

export async function initiateOnce(key: string, deps: InitiateOnceDeps): Promise<InitiateOnceResult> {
	const now = deps.now ?? (() => Date.now());
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const waitMs = deps.waitMs ?? CLAIM_WAIT_MS;
	const objectKey = claimObjectKey(key);
	const startedAt = now();
	let replaced: string | undefined;

	const claimFor = (owner: string, previous?: FingerprintClaim): FingerprintClaim => {
		const at = new Date(now()).toISOString();
		const history = previous?.videoId ? [...(previous.previous ?? []), previous.videoId].slice(-10) : previous?.previous;
		return {
			key,
			state: 'creating',
			owner,
			userId: deps.userId,
			channelId: deps.channelId,
			leaseUntil: now() + CLAIM_LEASE_MS,
			createdAt: previous?.createdAt ?? at,
			updatedAt: at,
			...(history?.length ? { previous: history } : {}),
		};
	};

	const createAndBind = async (claim: FingerprintClaim, etag: string): Promise<InitiateOnceResult> => {
		let videoId: string;
		try {
			videoId = await deps.create();
		} catch (error) {
			// Release the claim so a retry can create; only if it is still ours.
			try {
				const current = await deps.store.get(objectKey);
				if (current && current.etag === etag) await deps.store.delete(objectKey);
			} catch (releaseError) {
				logger.warn('[InitiateOnce] Could not release the claim (its lease expires)', {
					key,
					error: releaseError instanceof Error ? releaseError.message : String(releaseError),
				});
			}
			throw error;
		}
		const bound: FingerprintClaim = { ...claim, state: 'bound', videoId, leaseUntil: 0, updatedAt: new Date(now()).toISOString() };
		const written = await deps.store.put(objectKey, JSON.stringify(bound), { onlyIf: { etagMatches: etag }, httpMetadata: JSON_META });
		if (!written) {
			// Our lease ran out while creating and another request took the claim
			// over. Our video is still valid for this request; the other request
			// binds its own. The unbound one is reaped as abandoned if unused.
			logger.warn('[InitiateOnce] Claim taken over while creating; returning our video unbound', { key, videoId });
		}
		logger.info('[InitiateOnce] Created and bound a new upload video', { key, videoId, replaced });
		return { videoId, reused: false, ...(replaced ? { replaced } : {}) };
	};

	for (let round = 0; ; round++) {
		const object = await deps.store.get(objectKey);
		if (!object) {
			const claim = claimFor(crypto.randomUUID());
			const written = await deps.store.put(objectKey, JSON.stringify(claim), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: JSON_META });
			if (written) return createAndBind(claim, written.etag);
			continue; // lost the create race: read the winner's claim
		}

		const current = await object.json<FingerprintClaim>();
		if (current.state === 'bound' && current.videoId) {
			const verdict = await deps.check(current.videoId);
			if (verdict.kind === 'reuse') {
				logger.info('[InitiateOnce] Reusing the unfinished upload video', { key, videoId: current.videoId });
				return { videoId: current.videoId, reused: true };
			}
			replaced = verdict.why;
			const claim = claimFor(crypto.randomUUID(), current);
			const written = await deps.store.put(objectKey, JSON.stringify(claim), { onlyIf: { etagMatches: object.etag }, httpMetadata: JSON_META });
			if (written) return createAndBind(claim, written.etag);
			continue; // someone else replaced it first
		}

		// creating
		if (current.leaseUntil <= now()) {
			const claim = claimFor(crypto.randomUUID(), current);
			const written = await deps.store.put(objectKey, JSON.stringify(claim), { onlyIf: { etagMatches: object.etag }, httpMetadata: JSON_META });
			if (written) {
				logger.warn('[InitiateOnce] Took over an expired creating claim', { key });
				return createAndBind(claim, written.etag);
			}
			continue;
		}
		if (now() - startedAt >= waitMs) throw new UploadClaimBusyError(key);
		await sleep(Math.min(250 * 2 ** Math.min(round, 3), 1000));
	}
}

/** Drop the claim when it still points at `videoId` (the reaper, after abandoning it). */
export async function releaseClaimFor(store: ClaimStore, key: string, videoId: string): Promise<boolean> {
	const objectKey = claimObjectKey(key);
	const object = await store.get(objectKey);
	if (!object) return false;
	const claim = await object.json<FingerprintClaim>();
	if (claim.videoId !== videoId) return false;
	await store.delete(objectKey);
	return true;
}
