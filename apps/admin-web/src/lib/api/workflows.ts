'use server';

/**
 * Approval workflows (wiki AUN-WORKFLOWS §8, §10) through admin-api /api/workflows. Every admin role
 * can read; who may approve, reject or change a rule is decided by admin-api from the request's rule
 * (and its floors), which also runs the step-up. Mutations return an ActionResult instead of throwing,
 * because production builds redact server-action error messages.
 */
import type { WorkflowActionType, WorkflowDomain, WorkflowFloor, WorkflowLocalized, WorkflowRequestView, WorkflowRuleConfig, WorkflowStatus } from '@al-ummah/shared-types';
import type { ActionResult } from './errors';
import { logger } from '@/lib/logger';
import { requestAdmin, toResult } from './request';

export type WorkflowView = 'waiting' | 'mine' | 'open' | 'history';

export interface WorkflowListItem {
  id: string;
  type: WorkflowActionType;
  domain: string;
  title: WorkflowLocalized;
  status: WorkflowStatus;
  proposedBy: string;
  proposedAt: string;
  expiresAt: string;
  approvalsNeeded: number;
  approvalsCount: number;
}

export interface WorkflowRuleInForce {
  scope: string;
  version: number;
  config: WorkflowRuleConfig;
  floor: WorkflowFloor;
  /** May the signed-in admin propose a change to this rule (admin-api's own check) */
  canEdit?: boolean;
}

export interface WorkflowActionInfo {
  type: WorkflowActionType;
  domain: WorkflowDomain;
  label: WorkflowLocalized;
  scoped: boolean;
  floor: WorkflowFloor;
  /** false: registered for later; its rule can't be changed yet */
  connected?: boolean;
  rules: WorkflowRuleInForce[];
}

export interface WorkflowRuleVersion {
  id: string;
  version: number;
  config: WorkflowRuleConfig;
  request_id: string | null;
  created_by: string;
  created_at: string;
}

export type WorkflowProposeResult = { status: 'applied'; requestId: string; result: unknown } | { status: 'pending_approval' | 'failed'; request: WorkflowRequestView };

/**
 * The open change request of each target (`kind:id`), so a page shows "Waiting for approval" in place of the
 * control (§10). A failure only hides the marks: a second change is refused by admin-api (change_pending).
 */
export async function openWorkflowRequests(type: WorkflowActionType, targets: string[]): Promise<Record<string, string>> {
  if (!targets.length) return {};
  const q = new URLSearchParams({ type });
  for (const target of targets.slice(0, 100)) q.append('target', target);
  try {
    const body = await requestAdmin(`/api/workflows/pending?${q}`);
    return (body.result as { items?: Record<string, string> } | undefined)?.items ?? {};
  } catch (error) {
    logger.warn('[approvals] Open requests unavailable', { type, error: error instanceof Error ? error.message : String(error) });
    return {};
  }
}

export async function listWorkflowRequests(params: { view: WorkflowView; status?: WorkflowStatus; type?: WorkflowActionType; cursor?: string }): Promise<{ items: WorkflowListItem[]; next: string | null }> {
  const q = new URLSearchParams({ view: params.view });
  if (params.status) q.set('status', params.status);
  if (params.type) q.set('type', params.type);
  if (params.cursor) q.set('cursor', params.cursor);
  const body = await requestAdmin(`/api/workflows/requests?${q}`);
  const page = body.result as Partial<{ items: WorkflowListItem[]; next: string | null }> | undefined;
  return { items: page?.items ?? [], next: page?.next ?? null };
}

/** The live search box over requests (newest 200, matched on the title in either language). */
export async function suggestWorkflowRequests(query: string): Promise<ActionResult<{ items: { id: string; type: WorkflowActionType; title: WorkflowLocalized; status: WorkflowStatus; proposedAt: string }[] }>> {
  return toResult(async () => (await requestAdmin(`/api/workflows/requests/suggest?q=${encodeURIComponent(query)}`)).result as { items: { id: string; type: WorkflowActionType; title: WorkflowLocalized; status: WorkflowStatus; proposedAt: string }[] });
}

export async function getWorkflowRequest(id: string): Promise<WorkflowRequestView> {
  return (await requestAdmin(`/api/workflows/requests/${encodeURIComponent(id)}`)).result as WorkflowRequestView;
}

/** The nav badge: requests waiting for the signed-in admin. */
export async function workflowsWaitingCount(): Promise<number> {
  const r = (await requestAdmin('/api/workflows/counts')).result as { waitingForMe?: number } | undefined;
  return Number(r?.waitingForMe ?? 0);
}

export async function getWorkflowActions(): Promise<WorkflowActionInfo[]> {
  return ((await requestAdmin('/api/workflows/actions')).result as { actions?: WorkflowActionInfo[] } | undefined)?.actions ?? [];
}

export async function getWorkflowRuleHistory(type: WorkflowActionType, scope: string): Promise<WorkflowRuleVersion[]> {
  const q = new URLSearchParams({ scope });
  return ((await requestAdmin(`/api/workflows/rules/${encodeURIComponent(type)}/history?${q}`)).result as { versions?: WorkflowRuleVersion[] } | undefined)?.versions ?? [];
}

const post = (path: string, body: unknown) => requestAdmin(path, { method: 'POST', body: JSON.stringify(body) });

export async function approveWorkflowRequest(id: string, version: number, note: string): Promise<ActionResult<WorkflowRequestView>> {
  return toResult(async () => (await post(`/api/workflows/requests/${encodeURIComponent(id)}/approve`, { version, note: note.trim() || undefined })).result as WorkflowRequestView);
}

export async function rejectWorkflowRequest(id: string, version: number, reason: string): Promise<ActionResult<WorkflowRequestView>> {
  return toResult(async () => (await post(`/api/workflows/requests/${encodeURIComponent(id)}/reject`, { version, reason })).result as WorkflowRequestView);
}

export async function withdrawWorkflowRequest(id: string, version: number): Promise<ActionResult<WorkflowRequestView>> {
  return toResult(async () => (await post(`/api/workflows/requests/${encodeURIComponent(id)}/withdraw`, { version })).result as WorkflowRequestView);
}

export async function commentOnWorkflowRequest(id: string, note: string): Promise<ActionResult<WorkflowRequestView>> {
  return toResult(async () => (await post(`/api/workflows/requests/${encodeURIComponent(id)}/comment`, { note })).result as WorkflowRequestView);
}

export async function retryWorkflowRequest(id: string): Promise<ActionResult<WorkflowRequestView>> {
  return toResult(async () => (await post(`/api/workflows/requests/${encodeURIComponent(id)}/retry`, {})).result as WorkflowRequestView);
}

/** Proposes a rule change; it is itself a request that someone else approves. */
export async function proposeWorkflowRule(type: WorkflowActionType, scope: string, config: WorkflowRuleConfig, reason: string): Promise<ActionResult<WorkflowProposeResult>> {
  return toResult(async () => (await post(`/api/workflows/rules/${encodeURIComponent(type)}`, { scope, config, reason })).result as WorkflowProposeResult);
}
