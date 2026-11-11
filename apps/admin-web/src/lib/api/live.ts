/**
 * Live streaming (admin-api /api/content/live/*), server side: the page's
 * first render. Changes go from the browser through the content pass-through
 * (lib/api/content-proxy.ts), where admin-api checks live:manage and audits.
 */
import type { AdminAuditEntry, LiveChannelOverride, LiveComparison, LiveProviderId, LiveProviderUsage, LiveRoutingSettings } from '@al-ummah/shared-types';
import type { LiveSessionItem } from '@/lib/live-streaming';
import { requestAdmin } from './request';

export interface LiveSettingsView {
  settings: LiveRoutingSettings;
  usage: Record<LiveProviderId, LiveProviderUsage>;
  overrides: LiveChannelOverride[];
}

export type LiveAuditEntry = AdminAuditEntry & { previous?: Record<string, unknown> | null };

async function get<T>(endpoint: string): Promise<T> {
  return (await requestAdmin(endpoint)).result as T;
}

export const getLiveSettings = () => get<LiveSettingsView>('/api/content/live/settings');
export const getLiveSessions = (status: 'active' | 'recent', limit = 50) => get<{ items: LiveSessionItem[] }>(`/api/content/live/sessions?status=${status}&limit=${limit}`).then((r) => r.items);
export const getLiveComparison = (from: string, to: string, tests: boolean) =>
  get<LiveComparison>(`/api/content/live/compare?${new URLSearchParams({ from, to, tests: tests ? '1' : '0' })}`);
export const getLiveAudit = () => get<{ items: LiveAuditEntry[] }>('/api/content/live/audit?limit=50').then((r) => r.items);
