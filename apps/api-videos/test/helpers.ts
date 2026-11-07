/**
 * Test helpers: in-memory R2 bucket and a Hono/chanfana app factory that
 * mirrors the production auth context wiring.
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';

export class MemoryBucket {
	store = new Map<string, string>();
	/** Last-write time per key, reported as R2Object.uploaded by list(). */
	uploaded = new Map<string, Date>();
	/** Number of get/put/delete/list calls (to check operation budgets). */
	calls = 0;

	constructor(initial: Record<string, unknown> = {}) {
		for (const [k, v] of Object.entries(initial)) {
			this.store.set(k, JSON.stringify(v));
			this.uploaded.set(k, new Date());
		}
	}

	async get(key: string) {
		this.calls++;
		const raw = this.store.get(key);
		if (raw === undefined) return null;
		return { key, json: async () => JSON.parse(raw), text: async () => raw };
	}

	async put(key: string, value: string) {
		this.calls++;
		this.store.set(key, value);
		this.uploaded.set(key, new Date());
	}

	async delete(keys: string | string[]) {
		this.calls++;
		for (const key of Array.isArray(keys) ? keys : [keys]) {
			this.store.delete(key);
			this.uploaded.delete(key);
		}
	}

	async list(opts: { limit?: number; cursor?: string; prefix?: string } = {}) {
		this.calls++;
		// Key-based cursor like R2: resumes after the last returned key, so
		// deleting objects between pages does not skip any.
		const keys = [...this.store.keys()]
			.filter((k) => !opts.prefix || k.startsWith(opts.prefix))
			.sort()
			.filter((k) => !opts.cursor || k > opts.cursor);
		const limit = opts.limit ?? 1000;
		const page = keys.slice(0, limit);
		const truncated = limit < keys.length;
		return {
			objects: page.map((key) => ({ key, uploaded: this.uploaded.get(key) })),
			truncated,
			cursor: truncated ? page[page.length - 1] : undefined,
		};
	}

	read<T = any>(key: string): T | null {
		const raw = this.store.get(key);
		return raw === undefined ? null : JSON.parse(raw);
	}
}

export class MemoryQueue {
	messages: any[] = [];
	async send(msg: unknown) {
		this.messages.push(msg);
	}
}

/**
 * Build an app with the given routes. `userId` simulates authMiddleware /
 * optionalAuthMiddleware having validated a token.
 */
export function buildApp(
	register: (router: any) => void,
	auth?: { userId: string } | null,
) {
	const app = new Hono();
	app.use('*', async (c, next) => {
		if (auth) {
			c.set('auth' as never, { userId: auth.userId, email: `${auth.userId}@test.local`, payload: {} } as never);
			c.set('userId' as never, auth.userId as never);
		}
		await next();
	});
	const router = fromHono(app);
	register(router);
	return app;
}

export function videoFixture(overrides: Record<string, unknown> = {}) {
	return {
		id: 'v1',
		title: 'Video',
		userId: 'owner',
		channelId: 'owner-ch',
		dateCreated: '2026-01-01T00:00:00.000Z',
		dateModified: '2026-01-01T00:00:00.000Z',
		views: 0,
		tags: [],
		availableResolutions: [],
		comments: [],
		likes: [],
		dislikes: [],
		isPublic: true,
		isLive: false,
		...overrides,
	};
}

export function commentFixture(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		videoId: 'v1',
		userId: 'u1',
		channelId: 'ch1',
		text: `comment ${id}`,
		dateCreated: '2026-01-01T00:00:00.000Z',
		dateModified: '2026-01-01T00:00:00.000Z',
		likes: [],
		dislikes: [],
		replies: [],
		isEdited: false,
		isDeleted: false,
		isPinned: false,
		...overrides,
	};
}
