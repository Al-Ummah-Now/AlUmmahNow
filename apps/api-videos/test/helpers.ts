/**
 * Test helpers: in-memory R2 bucket and a Hono/chanfana app factory that
 * mirrors the production auth context wiring.
 */
import { Hono } from 'hono';
import { fromHono } from 'chanfana';

export class MemoryBucket {
	store = new Map<string, string>();

	constructor(initial: Record<string, unknown> = {}) {
		for (const [k, v] of Object.entries(initial)) this.store.set(k, JSON.stringify(v));
	}

	async get(key: string) {
		const raw = this.store.get(key);
		if (raw === undefined) return null;
		return { key, json: async () => JSON.parse(raw), text: async () => raw };
	}

	async put(key: string, value: string) {
		this.store.set(key, value);
	}

	async delete(key: string) {
		this.store.delete(key);
	}

	async list(opts: { limit?: number; cursor?: string; prefix?: string } = {}) {
		const keys = [...this.store.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
		const start = opts.cursor ? parseInt(opts.cursor, 10) : 0;
		const limit = opts.limit ?? 1000;
		const page = keys.slice(start, start + limit);
		const truncated = start + limit < keys.length;
		return {
			objects: page.map((key) => ({ key })),
			truncated,
			cursor: truncated ? String(start + limit) : undefined,
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
