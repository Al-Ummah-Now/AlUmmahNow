import { Str } from 'chanfana';
import { z } from 'zod';
import type { Subject } from '@al-ummah/shared-types';
import { AuthenticatedRoute, AppContext } from '../../base';
import { getEntitlements, getUsage } from '../../lib/entitlements';
import R2Repository from '../../lib/r2Repo';
import { Channel as BusinessChannel } from '../../lib/types';

const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const isAdmin = (roles: unknown) =>
	Array.isArray(roles) && roles.some((r) => ADMIN_ROLES.has(String(r).trim().toLowerCase().replace(/[\s-]+/g, '_')));

export class EntitlementsGet extends AuthenticatedRoute {
	schema = {
		tags: ['Entitlements'],
		summary: "A subject's plan, resolved entitlements and usage",
		request: {
			query: z.object({ subject: Str({ description: 'channel:{id} or user:{id}' }) }),
		},
		responses: {
			'200': { description: 'Resolved entitlements' },
			'400': { description: 'Invalid subject' },
			'403': { description: 'Not your subject' },
			'404': { description: 'Channel not found' },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const admin = isAdmin(c.get('auth')?.payload?.roles);
		const separator = query.subject.indexOf(':');
		const type = query.subject.slice(0, separator);
		const id = query.subject.slice(separator + 1);
		if (separator < 1 || !id || (type !== 'channel' && type !== 'user')) {
			return c.json({ success: false, error: 'Invalid subject' }, 400);
		}

		let ownerId = id;
		const subjects: Subject[] = [];
		if (type === 'channel') {
			const channel = await new R2Repository<z.infer<typeof BusinessChannel>>(c.env.channels).getObject(id);
			if (!channel) return c.json({ success: false, error: 'Channel not found' }, 404);
			ownerId = channel.userId;
			subjects.push({ type: 'channel', id });
		}
		subjects.push({ type: 'user', id: ownerId });
		if (ownerId !== userId && !admin) return c.json({ success: false, error: 'Forbidden' }, 403);

		const snapshot = await getEntitlements(c.env, subjects);
		return {
			success: true,
			result: { subject: query.subject, plan: snapshot.plan, entitlements: snapshot.entitlements, usage: await getUsage(c.env, ownerId, snapshot), degraded: snapshot.degraded },
		};
	}
}
