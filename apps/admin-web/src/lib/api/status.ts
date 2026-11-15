'use server';

/**
 * Status page incidents and maintenance (admin-api /api/status, status:manage). The public page
 * (apps/status) reads the same D1 and shows a change within about 30 seconds (its edge cache).
 */
import type { ActionResult } from './errors';
import { fetchAdmin, toResult } from './request';
import type { IncidentUpdateInput, NewIncidentInput, NewStatusWebhook, StatusIncident, StatusOverview, StatusSubscriptions } from './status-types';

const incidentPath = (id: string, action?: 'updates' | 'restore' | 'purge') => `/api/status/incidents/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

export async function getStatusOverview(): Promise<StatusOverview> {
  return fetchAdmin<StatusOverview>('/api/status/overview');
}

export async function createIncident(input: NewIncidentInput): Promise<ActionResult<StatusIncident>> {
  return toResult(() => fetchAdmin<StatusIncident>('/api/status/incidents', json('POST', input)));
}

export async function postIncidentUpdate(id: string, input: IncidentUpdateInput): Promise<ActionResult<StatusIncident>> {
  return toResult(() => fetchAdmin<StatusIncident>(incidentPath(id, 'updates'), json('POST', input)));
}

export async function deleteIncident(id: string): Promise<ActionResult<StatusIncident>> {
  return toResult(() => fetchAdmin<StatusIncident>(incidentPath(id), { method: 'DELETE' }));
}

export async function restoreIncident(id: string): Promise<ActionResult<StatusIncident>> {
  return toResult(() => fetchAdmin<StatusIncident>(incidentPath(id, 'restore'), { method: 'POST' }));
}

export async function purgeIncident(id: string): Promise<ActionResult<{ id: string }>> {
  return toResult(() => fetchAdmin<{ id: string }>(incidentPath(id, 'purge'), { method: 'POST' }));
}

/** Subscriptions (admin-api /api/status/subscriptions, webhooks, subscribers, notifications). */
export async function getStatusSubscriptions(): Promise<StatusSubscriptions> {
  return fetchAdmin<StatusSubscriptions>('/api/status/subscriptions');
}

export async function addStatusWebhook(input: { name: string; url: string }): Promise<ActionResult<NewStatusWebhook>> {
  return toResult(() => fetchAdmin<NewStatusWebhook>('/api/status/webhooks', json('POST', input)));
}

export async function deleteStatusWebhook(id: string): Promise<ActionResult<{ id: string }>> {
  return toResult(() => fetchAdmin<{ id: string }>(`/api/status/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function removeStatusSubscriber(email: string): Promise<ActionResult<{ removed: boolean }>> {
  return toResult(() => fetchAdmin<{ removed: boolean }>('/api/status/subscribers/remove', json('POST', { email })));
}

export async function retryStatusNotification(id: string): Promise<ActionResult<{ queued: number }>> {
  return toResult(() => fetchAdmin<{ queued: number }>(`/api/status/notifications/${encodeURIComponent(id)}/retry`, { method: 'POST' }));
}
