/**
 * People watching a live stream now (AlUmmahNow#30).
 *
 * One object per stream, named `liveviewers:<streamId>` (same
 * WebSocketDurableObject class: releases cannot add classes). The watch page
 * sends a heartbeat through api-videos every VIEWER_BEAT_MS with a random id
 * kept for the tab; a viewer counts while their last heartbeat is at most
 * VIEWER_TTL_MS old, and a tab that closes says so at once (`leaving`).
 *
 * Memory only: no storage, no D1, no alarm. If the object is evicted, every
 * viewer is counted again within one heartbeat, so nothing needs keeping.
 */

/** How often the watch page beats (web components/live/useLiveViewers.ts uses the same value). */
export const VIEWER_BEAT_MS = 20_000;
/**
 * A viewer is gone after this long without a beat. Browsers run a hidden tab's timers about
 * once a minute, so a viewer listening in a background tab beats every ~60 s: 75 s keeps them.
 */
export const VIEWER_TTL_MS = 75_000;
/** Bounds memory against a flood of made-up ids (api-videos rate-limits the endpoint too). */
export const MAX_VIEWERS = 200_000;

/**
 * Viewers counted from one network (`net`: api-videos' hash of the client IP and the stream).
 * Generous, for a mosque or office sharing one address, while bounding made-up ids from one
 * machine (api-videos also rate-limits the heartbeats per IP).
 */
export const MAX_PER_NET = 50;

const VIEWER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const NET = /^[a-f0-9]{8,64}$/;

export function isViewerId(value: unknown): value is string {
  return typeof value === 'string' && VIEWER_ID.test(value);
}

export function isNet(value: unknown): value is string {
  return typeof value === 'string' && NET.test(value);
}

export class LiveViewers {
  /** viewer id -> last heartbeat and network, ordered by last heartbeat */
  private seen = new Map<string, { at: number; net: string }>();
  /** network -> viewers counted from it */
  private perNet = new Map<string, number>();

  /** Records a heartbeat (or a tab leaving) and returns who is watching now. */
  beat(viewerId: string, now: number, leaving = false, net = 'none'): number {
    this.expire(now);
    const known = this.seen.get(viewerId);
    if (known) this.drop(viewerId, known.net);
    if (!leaving) {
      // A known viewer keeps their place; a new one needs room on their network and overall
      const room = known || ((this.perNet.get(net) ?? 0) < MAX_PER_NET && this.seen.size < MAX_VIEWERS);
      if (room) {
        this.seen.set(viewerId, { at: now, net });
        this.perNet.set(net, (this.perNet.get(net) ?? 0) + 1);
      }
    }
    return this.seen.size;
  }

  /** Viewers whose last heartbeat is recent enough. */
  count(now: number): number {
    this.expire(now);
    return this.seen.size;
  }

  private drop(viewerId: string, net: string): void {
    this.seen.delete(viewerId);
    const left = (this.perNet.get(net) ?? 1) - 1;
    if (left > 0) this.perNet.set(net, left);
    else this.perNet.delete(net);
  }

  private expire(now: number): void {
    for (const [id, v] of this.seen) {
      if (now - v.at <= VIEWER_TTL_MS) break;
      this.drop(id, v.net);
    }
  }
}
