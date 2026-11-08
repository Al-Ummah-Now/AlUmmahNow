import { z } from "zod";
import { OptionalAuthRoute, AppContext } from "../../base";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from "../../lib/logger";

const MAX_EVENTS = 100;
const MAX_BODY_BYTES = 64 * 1024;

export const ClientAnalyticsBody = z.object({
  kind: z.enum(["ab_test", "performance"]),
  events: z.array(z.record(z.unknown())).min(1).max(MAX_EVENTS),
  userAgent: z.string().max(512).optional(),
  referrer: z.string().max(2048).optional(),
});

/**
 * POST /api/analytics/events
 * Accepts batches of client telemetry (A/B test exposures/conversions, web vitals,
 * player performance) from the web app's route handlers and publishes them to the
 * queue, where the processor persists them with every other event.
 */
export class ClientAnalyticsEventsCreate extends OptionalAuthRoute {
  schema = {
    tags: ["Analytics"],
    summary: "Ingest client analytics events",
    description: "🔓 Authentication optional. Queues a batch (max 100 events, 64KB) of client telemetry as MessageType.ClientAnalyticsEvent.",
    request: {
      body: { content: { "application/json": { schema: ClientAnalyticsBody } } },
    },
    responses: {
      "202": {
        description: "Accepted",
        content: { "application/json": { schema: z.object({ success: z.boolean(), accepted: z.number() }) } },
      },
      "400": {
        description: "Invalid batch",
        content: { "application/json": { schema: z.object({ success: z.boolean(), error: z.string() }) } },
      },
    },
  };

  async handle(c: AppContext) {
    const { body } = await this.getValidatedData<typeof this.schema>();
    const size = JSON.stringify(body.events).length;
    if (size > MAX_BODY_BYTES) {
      return c.json({ success: false, error: "Event batch too large" }, 400);
    }

    const userId = this.getUserId(c);
    await new Queue(c.env.queue).send(MessageType.ClientAnalyticsEvent, {
      kind: body.kind,
      events: body.events,
      userId,
      userAgent: body.userAgent,
      referrer: body.referrer,
      receivedAt: new Date().toISOString(),
    });
    logger.info("[ClientAnalytics] Batch queued", { kind: body.kind, count: body.events.length, userId });
    return c.json({ success: true, accepted: body.events.length }, 202);
  }
}
