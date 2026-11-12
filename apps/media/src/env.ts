import type { Transcoder } from './transcoder';

export interface SecretBinding {
	get(): Promise<string>;
}

export interface Env {
	/** al-ummah-now-media[-env]: public renditions (pub/…), behind the R2 custom domain */
	MEDIA: R2Bucket;
	/** al-ummah-now-media-private[-env]: private and unlisted renditions (priv/…), no public access */
	MEDIA_PRIVATE: R2Bucket;
	/** al-ummah-now-media-originals[-env]: uploads as received (read only here) */
	MEDIA_ORIGINALS?: R2Bucket;
	TRANSCODER: DurableObjectNamespace<Transcoder>;
	/** api-videos (service binding): source URL, job events */
	VIDEOS: Fetcher;
	/** HMAC key of /priv/ path tokens (shared with api-videos) */
	MEDIA_SIGN_KEY: SecretBinding | string;
	/** X-API-Key for api-videos /internal/* */
	INTERNAL_API_KEY: SecretBinding | string;
	/** Instance type in wrangler config, recorded with each job for cost */
	TRANSCODER_INSTANCE?: string;
	LOG_LEVEL?: string;
}

const cache = new Map<string, { at: number; value: string }>();

/** Secrets Store value (cached 5 min per isolate) or a plain string in local dev. */
export async function secret(binding: SecretBinding | string | undefined, name: string): Promise<string> {
	if (!binding) throw new Error(`${name} is not bound`);
	if (typeof binding === 'string') return binding;
	const hit = cache.get(name);
	if (hit && Date.now() - hit.at < 300_000) return hit.value;
	const value = await binding.get();
	cache.set(name, { at: Date.now(), value });
	return value;
}

export const log = {
	warn(msg: string, extra: Record<string, unknown> = {}) {
		console.warn(JSON.stringify({ level: 'warn', msg, ...extra }));
	},
	error(msg: string, extra: Record<string, unknown> = {}) {
		console.error(JSON.stringify({ level: 'error', msg, ...extra }));
	},
};

/** The bucket that holds a key: priv/… is never in the public bucket. */
export function bucketFor(env: Pick<Env, 'MEDIA' | 'MEDIA_PRIVATE'>, key: string): R2Bucket {
	return key.startsWith('priv/') ? env.MEDIA_PRIVATE : env.MEDIA;
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
