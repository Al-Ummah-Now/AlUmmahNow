/** Converts between entitlement values and the text in admin forms (Epic 27). */
import { UNLIMITED, validateEntitlementValue, type EntitlementDefinition, type EntitlementValue } from '@al-ummah/shared-types';

export type ParsedValue = { ok: true; value: EntitlementValue } | { ok: false; error: string };

export function parseEntitlementInput(def: EntitlementDefinition, raw: string): ParsedValue {
  const text = raw.trim();
  let value: unknown = text;
  if (def.type === 'boolean') value = text === 'true';
  else if (def.type === 'number') value = text.toLowerCase() === UNLIMITED ? UNLIMITED : text === '' ? NaN : Number(text);
  else if (def.type === 'list') value = text.split(',').map((s) => s.trim()).filter(Boolean);
  const problem = validateEntitlementValue(def.key, value);
  return problem ? { ok: false, error: problem } : { ok: true, value: value as EntitlementValue };
}

export function entitlementInputText(value: EntitlementValue | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Turns the form's text into plan values. Blank fields are left out, so they fall through to the default plan. */
export function collectPlanValues(catalogue: readonly EntitlementDefinition[], text: Record<string, string>): { values: Record<string, EntitlementValue> } | { error: string } {
  const values: Record<string, EntitlementValue> = {};
  for (const def of catalogue) {
    const raw = text[def.key];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = parseEntitlementInput(def, raw);
    if (parsed.ok === false) return { error: parsed.error };
    values[def.key] = parsed.value;
  }
  return { values };
}

export const canManagePlans = (role?: string): boolean => role === 'admin' || role === 'super_admin';
