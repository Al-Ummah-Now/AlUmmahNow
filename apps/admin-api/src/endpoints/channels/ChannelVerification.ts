import { AdminRoute, AppContext } from "../../base";
import { hasContentPermission } from "@al-ummah/shared-types";
import { Str } from "../../lib/chanfana-params";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { ResponseError } from "../../lib/types";
import { logger } from "../../lib/logger";
import { type CasBucket } from '../../lib/r2Cas';
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { writeVerification, MAX_VERIFICATION_NOTE, VERIFICATION_KINDS, type VerificationLogRow } from "../../lib/channelVerification";

const VerificationState = z.object({
  channelId: z.string(),
  name: z.string().optional(),
  isVerified: z.boolean(),
  kind: z.enum(VERIFICATION_KINDS).nullable(),
  verifiedAt: z.string().nullable(),
  history: z.array(z.object({
    id: z.string(),
    verified: z.boolean(),
    kind: z.enum(VERIFICATION_KINDS).nullable(),
    note: z.string().nullable(),
    actorId: z.string(),
    createdAt: z.string(),
  })),
});

type ChannelRecord = { id?: string; name?: string; isVerified?: boolean; verificationKind?: string; verifiedAt?: string; [key: string]: unknown };

async function history(db: AppContext["env"]["REPORTS_DB"] | undefined, channelId: string) {
  if (!db) return [];
  const { results } = await db
    .prepare('SELECT * FROM channel_verification_log WHERE channel_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(channelId)
    .all<VerificationLogRow>();
  return (results ?? []).map((r) => ({ id: r.id, verified: r.verified === 1, kind: r.kind ?? null, note: r.note, actorId: r.actor_id, createdAt: r.created_at }));
}

function state(channelId: string, channel: ChannelRecord, rows: Awaited<ReturnType<typeof history>>) {
  return {
    channelId,
    name: typeof channel.name === 'string' ? channel.name : undefined,
    isVerified: channel.isVerified === true,
    kind: channel.isVerified === true && (channel.verificationKind === 'scholar' || channel.verificationKind === 'institution') ? channel.verificationKind : null,
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
    // The reason is internal to admins who may change the label (channels:manage); moderators see the rest
    const rows = await history(c.env.REPORTS_DB, channelId);
    const mayReadReasons = hasContentPermission(this.getRoles(c), 'channels:manage');
    return { success: true, result: state(channelId, channel, mayReadReasons ? rows : rows.map((r) => ({ ...r, note: null }))) };
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
    description: "Admins only (wiki Epic 21, E21-D4). Grants or removes the scholar label and appends an audit row. A reason is always required and stays internal; a grant names its kind (scholar or institution).",
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: z
              .object({
                verified: z.boolean(),
                kind: z.enum(VERIFICATION_KINDS).optional(),
                reason: z.string().trim().min(1).max(MAX_VERIFICATION_NOTE).describe("Why: required, internal only"),
              })
              .refine((b) => !b.verified || !!b.kind, { message: "kind is required when granting", path: ["kind"] }),
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
      note: body.reason,
      kind: body.verified ? body.kind : null,
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
      logger.info('[ChannelVerification] Verification changed', { channelId, verified: body.verified, kind: body.kind, actorId });
    }

    return {
      success: true,
      changed: result.changed,
      result: state(channelId, result.channel, await history(c.env.REPORTS_DB, channelId)),
    };
  }
}
