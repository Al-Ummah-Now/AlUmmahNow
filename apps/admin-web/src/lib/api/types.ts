/**
 * API Types for Admin Web
 *
 * Shared types used by admin API functions.
 * These are separated from server action files since 'use server'
 * files can only export async functions.
 */

import type {
  Report,
  ReportStatus,
  ReportableEntityType,
  ModerationAction,
} from '@al-ummah/shared-types';

// Moderation API types
export interface ListReportsParams {
  status?: ReportStatus;
  entity_type?: ReportableEntityType;
  limit?: number;
  offset?: number;
}

export interface ListReportsResponse {
  reports: Report[];
  total: number;
  limit: number;
  offset: number;
}

export interface TakeActionParams {
  action: ModerationAction;
  notes?: string;
}

export interface ActionResponse {
  report: Report;
  contentAction: {
    performed: boolean;
    action: string;
    notes?: string;
  };
}
