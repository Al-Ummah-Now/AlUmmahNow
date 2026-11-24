'use server';

/** Age rules (wiki E20 §5.2): admin-api /api/age-rules. Every admin role with features:read reads; super admins save. */
import type { AgeNumbers, FeatureText } from '@al-ummah/shared-types';
import { AdminApiError, type ActionResult } from './errors';
import { fetchAdmin, navigateForPasskey } from './request';

export interface AgeRulesView {
  numbers: AgeNumbers | null;
  suggested: AgeNumbers;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; name: string | null } | null;
  switchOn: boolean;
  checks: { key: 'birthDate' | 'numbers' | 'accountEvents'; ok: boolean; reason: FeatureText; reasonKey: string }[];
  canEdit: boolean;
}

export interface AgeRulesChange {
  id: string;
  from: AgeNumbers | null;
  to: AgeNumbers;
  actorId: string;
  actorName: string | null;
  createdAt: string;
}

export async function getAgeRules(): Promise<AgeRulesView> {
  return fetchAdmin<AgeRulesView>('/api/age-rules');
}

export async function getAgeRulesHistory(): Promise<AgeRulesChange[]> {
  const { entries } = await fetchAdmin<{ entries: AgeRulesChange[] }>('/api/age-rules/history?limit=10');
  return entries;
}

/** `expectedVersion` is what the page showed: a newer one answers 409 (code age_rules_changed). */
export async function saveAgeRules(numbers: AgeNumbers, expectedVersion: number): Promise<ActionResult<{ numbers: AgeNumbers; version: number }>> {
  try {
    return { ok: true, data: await fetchAdmin('/api/age-rules', { method: 'PUT', body: JSON.stringify({ numbers, expectedVersion }) }) };
  } catch (error) {
    await navigateForPasskey(error);
    if (error instanceof AdminApiError) return { ok: false, status: error.status, error: error.message, ...(error.code ? { code: error.code } : {}) };
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
