import { z } from 'zod';
import {
  QAF_ERROR_MESSAGES, can, channelRoleOf, reportNeedsAction, resolveNeedsAction, tierAllowsChannels, tierAllowsUploads,
  type Channel, type ErrorReporterEnv,
} from '@al-ummah/shared-types';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { resolveCreator } from '../../lib/creatorTiers';
import { logger } from '../../lib/logger';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { qafContextResult, qafLookup, qafLookupResult, qafPassageQuery, qafSearch, qafSearchResult } from '../../lib/qaf/schemas';
import { QafError, qafAvailable, queryQaf, type QafRequest } from '../../lib/qaf/service';
import { getChannelObject } from './post-comment-helpers';

const channel = z.object({ channelId: z.string().min(1).max(128) });
const error = z.object({ error: z.string(), retryAfter: z.number().optional() });
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const responses = (schema: z.ZodType) => ({
  200: { description: 'Source helper response', content: json(schema) },
  400: { description: 'Invalid request or filters', content: json(error) },
  403: { description: 'Posting is unavailable for this creator or channel', content: json(error) },
  404: { description: 'Channel or passage not found', content: json(error) },
  429: { description: 'Rate limited; Retry-After is supplied when known', content: json(error) },
  503: { description: 'Source helper unavailable', content: json(error) },
});

export const qafActionKey = (code: string) => `qaf-sources:${code}`;

abstract class QafRoute extends AuthenticatedRoute {
  protected async run(c: AppContext, request?: QafRequest) {
    const auth = this.getAuth(c);
    try {
      if (!c.env.SEARCH_DB) throw new QafError(503, 'unavailable');
      const object = await getChannelObject(c.env.channels, c.req.param('channelId'));
      if (!object) return c.json({ error: 'channel_not_found' }, 404);
      const record = await object.json() as Channel & { isDeleted?: boolean };
      if (record.isDeleted || record.isSuspended || !can(channelRoleOf(record as never, auth.userId), 'post.manage')) {
        return c.json({ error: 'forbidden' }, 403);
      }
      const { tier } = await resolveCreator(c.env.SEARCH_DB, {
        userId: auth.userId, roles: auth.payload.roles, channelOwnerId: record.userId,
      });
      if (!tierAllowsChannels(tier) && !tierAllowsUploads(tier)) return c.json({ error: 'forbidden' }, 403);

      c.header('Cache-Control', 'private, no-store');
      if (!request) return c.json({ enabled: await qafAvailable(c.env) });
      const env = c.env as ErrorReporterEnv;
      const result = await queryQaf(c.env, auth.userId, request, {
        report: (code, id) => {
          reportNeedsAction('api-videos', env, c.executionCtx, {
            key: qafActionKey(code), source: 'ops', title: QAF_ERROR_MESSAGES.title,
            itemType: 'integration', itemId: 'qaf', itemUrl: '/platform-settings',
            message: QAF_ERROR_MESSAGES[code],
            extra: { reason: code },
            requestId: id && /^[a-zA-Z0-9-]{1,64}$/.test(id) ? id : undefined,
          });
        },
        recovered: (code) => resolveNeedsAction(env, c.executionCtx, qafActionKey(code)),
      });
      return c.json(result);
    } catch (error) {
      if (!(error instanceof QafError)) {
        logger.error('[Qaf] Source helper failed', { operation: request?.kind ?? 'availability' });
        return c.json({ error: 'unavailable' }, 503);
      }
      if (error.retryAfter !== undefined) c.header('Retry-After', String(error.retryAfter));
      return c.json({ error: error.code, retryAfter: error.retryAfter }, error.status);
    }
  }
}

export class QafAvailability extends QafRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Check whether source search is enabled',
    request: { params: channel }, responses: responses(z.object({ enabled: z.boolean() })),
  }, 'required');

  handle(c: AppContext) { return this.run(c); }
}

export class QafSearch extends QafRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Search classical Islamic sources',
    request: { params: channel, body: { content: { 'application/json': { schema: qafSearch } } } },
    responses: responses(qafSearchResult),
  }, 'required');

  async handle(c: AppContext) {
    const { body } = await this.getValidatedData<typeof this.schema>();
    return this.run(c, { kind: 'search', input: body });
  }
}

export class QafReadPassage extends QafRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Read a source passage and its neighbours',
    request: { params: channel.extend({ id: z.uuid() }), query: qafPassageQuery },
    responses: responses(qafContextResult),
  }, 'required');

  async handle(c: AppContext) {
    const { params, query } = await this.getValidatedData<typeof this.schema>();
    return this.run(c, { kind: 'context', id: params.id, input: query });
  }
}

export class QafCatalogLookup extends QafRoute {
  schema = addAuthToSchema({
    tags: ['Community'], summary: 'Look up a source author or book',
    request: { params: channel, query: qafLookup }, responses: responses(qafLookupResult),
  }, 'required');

  async handle(c: AppContext) {
    const { query } = await this.getValidatedData<typeof this.schema>();
    return this.run(c, { kind: 'catalog', input: query });
  }
}
