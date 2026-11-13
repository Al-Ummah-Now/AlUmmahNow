/**
 * Abuse counters (admin-api GET /api/abuse/summary, ops:read): Turnstile outcomes and
 * rate-limit refusals per endpoint from Analytics Engine. Server components only.
 */
import { fetchAdmin } from './request';

export type AbuseEnv = 'production' | 'stage' | 'qa';
export const ABUSE_ENVS: AbuseEnv[] = ['production', 'stage', 'qa'];
export const ABUSE_KINDS = ['turnstile_pass', 'turnstile_fail', 'turnstile_missing', 'turnstile_error', 'rate_limited', 'bad_user_agent', 'bypass'] as const;
export type AbuseKind = (typeof ABUSE_KINDS)[number];

export interface AbuseSummary {
  env: AbuseEnv;
  hours: number;
  generatedAt: string;
  rows: { app: string; endpoint: string; kind: string; count: number }[];
  totals: Record<string, number>;
}

export async function getAbuseSummary(env: AbuseEnv, hours: number): Promise<AbuseSummary> {
  return fetchAdmin<AbuseSummary>(`/api/abuse/summary?env=${env}&hours=${hours}`);
}
