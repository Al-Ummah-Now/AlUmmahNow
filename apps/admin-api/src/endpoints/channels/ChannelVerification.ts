import { AdminRoute, AppContext } from "../../base";
import { Str } from "chanfana";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError } from "../../lib/types";
import { logger } from "../../lib/logger";
import { type CasBucket } from '../../lib/r2Cas';
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { writeVerification, MAX_VERIFICATION_NOTE, type VerificationLogRow } from "../../lib/channelVerification";

const VerificationState = z.object({
  channelId: z.string(),
  name: z.string().optional(),
  isVerified: z.boolean(),
  verifiedAt: z.string().nullable(),
  history: z.array(z.object({
    id: z.string(),
    verified: z.boolean(),
    note: z.string().nullable(),
    actorId: z.string(),
    createdAt: z.string(),
  })),
});

type ChannelRecord = { id?: string; name?: string; isVerified?: boolean; verifiedAt?: string; [key: string]: unknown };

async function history(db: AppContext["env"]["REPORTS_DB"] | undefined, channelId: string) {
  if (!db) return [];
  const { results } = await db
    .prepare('SELECT * FROM channel_verification_log WHERE channel_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(channelId)
    .all<VerificationLogRow>();
  return (results ?? []).map((r) => ({ id: r.id, verified: r.verified === 1, note: r.note, actorId: r.actor_id, createdAt: r.created_at }));
}

function state(channelId: string, channel: ChannelRecord, rows: Awaited<ReturnType<typeof history>>) {
  return {
    channelId,
    name: typeof channel.name === 'string' ? channel.name : undefined,
    isVerified: channel.isVerified === true,
    verifiedAt: channel.isVerified === true && typeof channel.verifiedAt === 'string' ? channel.verifiedAt : null,
    history: rows,
  };
}

const params = z.object({ channelId: Str({ description: "Channel ID" }) });
const errors = {
  "403": { description: "Admin role required", content: { "application/json": { schema: ResponseError } } },
  "404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
};

/** GET /api/channels/:channelId/verification — current state and audit history (moderators and admins). */
export class ChannelVerificationGet extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Channels"],
    summary: "Get channel verification",
    request: { params },
    responses: {
      "200": { description: "Verification state", content: { "application/json": { schema: z.object({ success: z.boolean(), result: VerificationState }) } } },
      ...errors,
    },
  });

  async handle(c: AppContext) {
    const { params: { channelId } } = await this.getValidatedData<typeof this.schema>();
    const channel = await new R2Repository<ChannelRecord>(c.env.channels).getObject(channelId);
    if (!channel) return c.json({ success: false, error: 'Channel not found' }, 404);
    return { success: true, result: state(channelId, channel, await history(c.env.REPORTS_DB, channelId)) };
  }
}

/**
 * PUT /api/channels/:channelId/verification — verify or unverify a channel
 * (admins and super admins only; moderators get 403). Every change is
 * recorded in channel_verification_log.
 */
export class ChannelVerificationPut extends AdminRoute {
  schema = addAuthToSchema({
    tags: ["Channels"],
    summary: "Set channel verification",
    description: "Admins only. Sets isVerified on the channel and appends an audit row. The note records the credentials reviewed.",
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              verified: z.boolean(),
              note: z.string().max(MAX_VERIFICATION_NOTE).optional(),
            }),
          },
        },
      },
    },
    responses: {
      "200": { description: "Updated verification state", content: { "application/json": { schema: z.object({ success: z.boolean(), changed: z.boolean(), result: VerificationState }) } } },
      ...errors,
    },
  });

  async handle(c: AppContext) {
    if (!this.isAdmin(c)) {
      logger.warn('[ChannelVerification] Non-admin attempted a verification change', { userId: this.getUserId(c) });
      return c.json({ success: false, error: 'Admin role required' }, 403);
    }
    const { params: { channelId }, body } = await this.getValidatedData<typeof this.schema>();
    const actorId = this.getUserId(c);
    const result = await writeVerification<ChannelRecord>(c.env.REPORTS_DB, c.env.channels as unknown as CasBucket, channelId, {
      verified: body.verified,
      note: body.note,
      actorId,
      now: new Date().toISOString(),
      id: crypto.randomUUID(),
    });
    if (!result) return c.json({ success: false, error: 'Channel not found' }, 404);

    if (result.changed) {
      // admin-api writes R2 directly, so tell the processor to refresh the
      // channel's search row (search "verified" filter and badge).
      await new Queue(c.env.queue).send(MessageType.SearchIndexSync, {
        entity: 'channel', id: channelId, object: result.channel, version: result.version ?? Date.now(),
      });
      logger.info('[ChannelVerification] Verification changed', { channelId, verified: body.verified, actorId });
    }

    return {
      success: true,
      changed: result.changed,
      result: state(channelId, result.channel, await history(c.env.REPORTS_DB, channelId)),
    };
  }
}
