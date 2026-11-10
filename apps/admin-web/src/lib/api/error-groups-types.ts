/**
 * Shapes of admin-api /api/errors (apps/admin-api/src/endpoints/errors/ErrorsAdmin.ts
 * and src/lib/errors-store.ts rows). The retry spec never leaves admin-api:
 * an item only says whether it can be retried.
 */
import type { ErrorStatus, NeedsActionStatus } from '@al-ummah/shared-types';

export type ErrorSort = 'last_seen' | 'count' | 'users' | 'first_seen';

export interface ErrorGroup {
  id: string;
  environment: string;
  app: string;
  kind: string;
  name: string | null;
  message: string;
  culprit: string | null;
  route: string | null;
  status: ErrorStatus;
  occurrences: number;
  users: number;
  first_seen: string;
  last_seen: string;
  first_release: string | null;
  last_release: string | null;
  resolved_at: string | null;
  resolved_release: string | null;
  regressed_at: string | null;
  assignee_id: string | null;
  assignee_email: string | null;
  test: number;
}

export interface ErrorGroupListItem extends ErrorGroup {
  open_actions: number;
  /** Occurrences per UTC day, oldest first (14 days) */
  daily: number[];
}

export interface ErrorGroupList {
  groups: ErrorGroupListItem[];
  total: number;
  limit: number;
  offset: number;
}

export type ErrorCounts = Record<ErrorStatus, number> & { openActions: number };

export interface ErrorFacets {
  apps: string[];
  environments: string[];
  releases: string[];
}

export interface ErrorEvent {
  id: string;
  ref: string;
  kind: string;
  occurred_at: string;
  count: number;
  release: string | null;
  worker_version: string | null;
  environment: string | null;
  route: string | null;
  method: string | null;
  status: number | null;
  locale: string | null;
  theme: string | null;
  browser: string | null;
  os: string | null;
  user_id: string | null;
  request_id: string | null;
  name: string | null;
  message: string;
  stack: string | null;
  symbolicated_stack: string | null;
  shown: number;
}

export interface ErrorActivity {
  id: string;
  kind: 'created' | 'status' | 'assign' | 'note' | 'reopened' | 'alert' | 'retry' | 'item';
  from_status: string | null;
  to_status: string | null;
  body: string | null;
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
}

export interface NeedsActionItem {
  id: string;
  group_id: string;
  item_key: string;
  app: string;
  source: string;
  title: string;
  detail: string | null;
  item_type: string | null;
  item_id: string | null;
  item_url: string | null;
  retry_label: string | null;
  status: NeedsActionStatus;
  occurrences: number;
  attempts: number;
  last_attempt_at: string | null;
  last_attempt_result: string | null;
  last_attempt_by: string | null;
  created_at: string;
  updated_at: string;
  can_retry: boolean;
}

export interface ErrorGroupDetail {
  group: ErrorGroup;
  actions: NeedsActionItem[];
  events: ErrorEvent[];
  releases: { release: string; occurrences: number; first_seen: string; last_seen: string }[];
  activity: ErrorActivity[];
  hourly: { hour: string; occurrences: number }[];
  daily: number[];
}
