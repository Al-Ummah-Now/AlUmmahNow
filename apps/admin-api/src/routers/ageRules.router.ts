/**
 * /api/age-rules: the Age rules page (wiki E20 §5.2).
 *
 *   GET /          features:read   the saved ages (null: never saved), the suggested ones, whether the
 *                                  switch is on, and the three checks that let it be turned on
 *   PUT /          super admin     { numbers, expectedVersion }; 409 age_rules_changed when someone saved since
 *   GET /history   features:read   the latest changes
 *
 * Changes are audited in site_settings_log (key `age-rules`) and reach every server within 30 s.
 */
import { Hono, type Context } from 'hono';
import { SUGGESTED_AGE_NUMBERS, featureGate, isSuperAdmin, parseAgeNumbers, readAgeRules, sameAgeNumbers, writeAgeRules, type AgeNumbers } from '@al-ummah/shared-types';
import { hasPermission, type Permission } from '../lib/roles';
import { logger } from '../lib/logger';
import { apiError } from '../lib/api-error';
import { ageRulesChecks } from '../lib/age-rules-checks';
import { resolveNames } from '../lib/queue/names';
import { auditOriginJson } from '../lib/request-origin';
import type { AdminBindings, AuthContext } from '../base/types';

type Env = { Bindings: AdminBindings & { FEATURES_FORCE_OFF?: string }; Variables: { auth?: AuthContext } };
type C = Context<Env>;

export const AGE_RULES_AUDIT_KEY = 'age-rules';
const NO_STORE = { 'Cache-Control': 'private, no-store' };

const roles = (c: C) => c.get('auth')?.roles;
const actorOf = (c: C) => c.get('auth')?.userId ?? 'unknown';
const forbidden = (c: C, permission: Permission | 'super_admin') => {
  logger.warn('[AgeRules] Permission denied', { userId: actorOf(c), permission, path: c.req.path });
  return apiError(c, 403, 'forbidden', { error: `Missing permission ${permission}` });
};
const mayEdit = (c: C) => hasPermission(roles(c), 'features:manage') && isSuperAdmin(roles(c) ?? []);

const namesOf = async (c: C, ids: string[]) => (await resolveNames(c.env.SEARCH_DB as never, { profiles: ids })).profiles;

const app = new Hono<Env>();

app.get('/', async (c) => {
  if (!hasPermission(roles(c), 'features:read')) return forbidden(c, 'features:read');
  const [row, checks, gate] = await Promise.all([readAgeRules(c.env, { fresh: true }), ageRulesChecks(c.env), featureGate(c.env, 'ageRules')]);
  const names = row ? await namesOf(c, [row.updatedBy]) : null;
  return c.json(
    {
      success: true,
      result: {
        numbers: row?.numbers ?? null,
        suggested: SUGGESTED_AGE_NUMBERS,
        version: row?.version ?? 0,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row ? { id: row.updatedBy, name: names?.get(row.updatedBy) ?? null } : null,
        switchOn: gate.on,
        checks,
        canEdit: mayEdit(c),
      },
    },
    200,
    NO_STORE,
  );
});

app.put('/', async (c) => {
  if (!mayEdit(c)) return forbidden(c, 'super_admin');
  const body = (await c.req.json().catch(() => null)) as { numbers?: unknown; expectedVersion?: unknown } | null;
  const numbers = parseAgeNumbers(body?.numbers);
  const expectedVersion = body?.expectedVersion;
  if (!numbers || !Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) {
    return apiError(c, 400, 'invalid_request', { error: 'numbers (every key, each 13, 16 or 18) and expectedVersion (integer) are required' });
  }
  const current = await readAgeRules(c.env, { fresh: true });
  const changed = () => apiError(c, 409, 'age_rules_changed', { error: 'age_rules_changed' });
  if ((current?.version ?? 0) !== expectedVersion) return changed();
  if (current && sameAgeNumbers(current.numbers, numbers)) return c.json({ success: true, changed: false, result: { numbers, version: current.version } });

  const db = c.env.REPORTS_DB;
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(auditId, AGE_RULES_AUDIT_KEY, current ? JSON.stringify(current.numbers) : null, JSON.stringify(numbers), actorOf(c), now, auditOriginJson())
    .run();
  const drop = () =>
    db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(auditId).run().catch((error: unknown) =>
      logger.error('[AgeRules] Could not drop the audit row of a change that was not made', { auditId, error: String(error) }));
  let saved;
  try {
    saved = await writeAgeRules(c.env, { numbers, expectedVersion: expectedVersion as number, actorId: actorOf(c), now });
  } catch (error) {
    // The write may have landed: the row stays only if the numbers are there
    const after = await readAgeRules(c.env, { fresh: true }).catch(() => undefined);
    if (after !== undefined && !(after && after.version === (expectedVersion as number) + 1 && after.updatedAt === now)) await drop();
    throw error;
  }
  if (!saved) {
    await drop();
    return changed();
  }
  logger.info('[AgeRules] Ages changed', { actorId: actorOf(c), version: saved.version });
  return c.json({ success: true, changed: true, result: { numbers: saved.numbers, version: saved.version } });
});

app.get('/history', async (c) => {
  if (!hasPermission(roles(c), 'features:read')) return forbidden(c, 'features:read');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '10', 10) || 10, 1), 50);
  const { results } = await c.env.REPORTS_DB
    .prepare('SELECT id, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .bind(AGE_RULES_AUDIT_KEY, limit)
    .all<{ id: string; old_value: string | null; new_value: string; actor_id: string; created_at: string }>();
  const rows = results ?? [];
  const names = await namesOf(c, [...new Set(rows.map((r) => r.actor_id))]);
  const numbersOf = (raw: string | null): AgeNumbers | null => {
    try {
      return raw ? parseAgeNumbers(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };
  const entries = rows.flatMap((r) => {
    const to = numbersOf(r.new_value);
    return to ? [{ id: r.id, from: numbersOf(r.old_value), to, actorId: r.actor_id, actorName: names.get(r.actor_id) ?? null, createdAt: r.created_at }] : [];
  });
  return c.json({ success: true, result: { entries } }, 200, NO_STORE);
});

export default app;
