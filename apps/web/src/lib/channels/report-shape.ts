/** The shape of a channel failure report, shared by the browser and the sink route. Pure. */

export interface ChannelListFailure {
  reason: string;
  status?: number;
  /** What the user was doing: menu, switch, team-load, team-add, team-update, team-remove */
  action?: string;
  /** API error code, e.g. member_limit */
  code?: string;
}

export const MAX_CHANNEL_REPORT_BYTES = 2048;

const token = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[a-z0-9_.:-]{1,40}$/i.test(value) ? value : undefined;

/** Keep only short machine-readable fields; null when there is no reason. */
export function normalizeChannelFailure(input: unknown): ChannelListFailure | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const reason = token(raw.reason);
  if (!reason) return null;
  const status = typeof raw.status === 'number' && Number.isInteger(raw.status) && raw.status >= 0 && raw.status < 1000 ? raw.status : undefined;
  const action = token(raw.action);
  const code = token(raw.code);
  return { reason, ...(status !== undefined ? { status } : {}), ...(action ? { action } : {}), ...(code ? { code } : {}) };
}
