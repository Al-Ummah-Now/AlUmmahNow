/**
 * The Age rules page (wiki E20 §5.2):
 *
 *   GET /api/age-rules          features:read   the saved ages (null: never saved), the suggested ones, whether the
 *                                               switch is on, and the three checks that let it be turned on
 *   PUT /api/age-rules          super admin     { numbers, expectedVersion }; 409 age_rules_changed when someone
 *                                               saved since
 *   GET /api/age-rules/history  features:read   the latest changes
 *
 * Only the three limits of E20-D3 are settings. Changes are audited in site_settings_log (key `age-rules`) and reach
 * every server within 30 s.
 */
import { z } from 'zod';
import { AGE_CHOICES, SUGGESTED_AGE_NUMBERS, featureGate, isSuperAdmin, parseAgeNumbers, readAgeRules, sameAgeNumbers, writeAgeRules, type AgeNumbers } from '@al-ummah/shared-types';
import { AdminRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { hasPermission, type Permission } from '../../lib/roles';
import { logger } from '../../lib/logger';
import { apiError } from '../../lib/api-error';
import { ageRulesChecks } from '../../lib/age-rules-checks';
import { resolveNames } from '../../lib/queue/names';
import { auditOriginJson } from '../../lib/request-origin';

export const AGE_RULES_AUDIT_KEY = 'age-rules';
const TAGS = ['Age rules'];
const NO_STORE = { 'Cache-Control': 'private, no-store' };

const Age = z.union([z.literal(AGE_CHOICES[0]), z.literal(AGE_CHOICES[1]), z.literal(AGE_CHOICES[2])]).describe('13, 16 or 18');
const Numbers = z
  .object({ liveChat: Age.describe('Live chat'), support: Age.describe('Giving or receiving money'), ageRestricted: Age.describe('Watching age-restricted videos') })
  .strict()
  .describe('The three limits of E20-D3; everything else needs the account minimum, 13');
const Text = z.object({ en: z.string(), ar: z.string() });
const Person = z.object({ id: z.string(), name: z.string().nullable() });
const Check = z.object({ key: z.enum(['birthDate', 'numbers', 'accountEvents']), ok: z.boolean(), reason: Text, reasonKey: z.string() });
const ErrorBody = z.object({ success: z.literal(false), code: z.string() }).passthrough();
const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const refused = (description: string) => ({ description, content: json(ErrorBody) });

export const AgeRulesViewSchema = z.object({
  success: z.literal(true),
  result: z.object({
    numbers: Numbers.nullable().describe('Null until they are saved'),
    suggested: Numbers,
    version: z.number().int(),
    updatedAt: z.string().nullable(),
    updatedBy: Person.nullable(),
    switchOn: z.boolean(),
    checks: z.array(Check),
    canEdit: z.boolean(),
  }),
});
export const AgeRulesSaveSchema = z.object({ numbers: Numbers, expectedVersion: z.number().int().min(0).describe('The version that was shown; 0: never saved') }).strict();
export const AgeRulesSavedSchema = z.object({ success: z.literal(true), changed: z.boolean(), result: z.object({ numbers: Numbers, version: z.number().int() }) });
export const AgeRulesHistorySchema = z.object({
  success: z.literal(true),
  result: z.object({ entries: z.array(z.object({ id: z.string(), from: Numbers.nullable(), to: Numbers, actorId: z.string(), actorName: z.string().nullable(), createdAt: z.string() })) }),
});

const namesOf = async (c: AppContext, ids: string[]) => (await resolveNames(c.env.SEARCH_DB as never, { profiles: ids })).profiles;

abstract class AgeRulesRoute extends AdminRoute {
  protected deny(c: AppContext, permission: Permission | 'super_admin'): Response | null {
    const roles = this.getRoles(c);
    const allowed = permission === 'super_admin' ? hasPermission(roles, 'features:manage') && isSuperAdmin(roles) : hasPermission(roles, permission);
    if (allowed) return null;
    logger.warn('[AgeRules] Permission denied', { userId: this.getUserId(c), permission, path: c.req.path });
    return apiError(c as never, 403, 'forbidden', { error: `Missing permission ${permission}` });
  }
}

export class AgeRulesGet extends AgeRulesRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'The age for each thing, and whether the switch can be turned on',
    description: 'Needs features:read.',
    responses: { '200': { description: 'The ages and the checks', content: json(AgeRulesViewSchema) } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'features:read');
    if (denied) return denied;
    const env = c.env as never;
    const [row, checks, gate] = await Promise.all([readAgeRules(env, { fresh: true }), ageRulesChecks(env), featureGate(env, 'ageRules')]);
    const names = row ? await namesOf(c, [row.updatedBy]) : null;
    const result = {
      numbers: row?.numbers ?? null,
      suggested: SUGGESTED_AGE_NUMBERS,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row ? { id: row.updatedBy, name: names?.get(row.updatedBy) ?? null } : null,
      switchOn: gate.on,
      checks,
      canEdit: hasPermission(this.getRoles(c), 'features:manage') && isSuperAdmin(this.getRoles(c)),
    };
    return c.json({ success: true, result }, 200, NO_STORE);
  }
}

export class AgeRulesPut extends AgeRulesRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'Save the ages',
    description: 'Super admins only; audited.',
    request: { body: { content: json(AgeRulesSaveSchema) } },
    responses: {
      '200': { description: 'Saved, or nothing to change', content: json(AgeRulesSavedSchema) },
      '400': { description: 'Not the three limits, each 13, 16 or 18, with the version' },
      '409': refused('age_rules_changed: someone saved since'),
    },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'super_admin');
    if (denied) return denied;
    const { body } = await this.getValidatedData<typeof this.schema>();
    const { numbers, expectedVersion } = body as { numbers: AgeNumbers; expectedVersion: number };
    const env = c.env as never;
    const actorId = this.getUserId(c);
    const current = await readAgeRules(env, { fresh: true });
    const changed = () => apiError(c as never, 409, 'age_rules_changed', { error: 'age_rules_changed' });
    if ((current?.version ?? 0) !== expectedVersion) return changed();
    if (current && sameAgeNumbers(current.numbers, numbers)) return c.json({ success: true, changed: false, result: { numbers, version: current.version } });

    const db = c.env.REPORTS_DB;
    const auditId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .prepare('INSERT INTO site_settings_log (id, key, old_value, new_value, actor_id, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(auditId, AGE_RULES_AUDIT_KEY, current ? JSON.stringify(current.numbers) : null, JSON.stringify(numbers), actorId, now, auditOriginJson())
      .run();
    const drop = () =>
      db.prepare('DELETE FROM site_settings_log WHERE id = ?').bind(auditId).run().catch((error: unknown) =>
        logger.error('[AgeRules] Could not drop the audit row of a change that was not made', { auditId, error: String(error) }));
    let saved;
    try {
      saved = await writeAgeRules(env, { numbers, expectedVersion, actorId, now });
    } catch (error) {
      // The write may have landed: the row stays only if the numbers are there
      const after = await readAgeRules(env, { fresh: true }).catch(() => undefined);
      if (after !== undefined && !(after && after.version === expectedVersion + 1 && after.updatedAt === now)) await drop();
      throw error;
    }
    if (!saved) {
      await drop();
      return changed();
    }
    logger.info('[AgeRules] Ages changed', { actorId, version: saved.version });
    return c.json({ success: true, changed: true, result: { numbers: saved.numbers, version: saved.version } });
  }
}

export class AgeRulesHistory extends AgeRulesRoute {
  schema = addAuthToSchema({
    tags: TAGS,
    summary: 'The latest changes to the ages',
    description: 'Newest first. Needs features:read.',
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }) },
    responses: { '200': { description: 'The changes', content: json(AgeRulesHistorySchema) } },
  });

  async handle(c: AppContext) {
    const denied = this.deny(c, 'features:read');
    if (denied) return denied;
    const { query } = await this.getValidatedData<typeof this.schema>();
    const { results } = await c.env.REPORTS_DB
      .prepare('SELECT id, old_value, new_value, actor_id, created_at FROM site_settings_log WHERE key = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .bind(AGE_RULES_AUDIT_KEY, (query as { limit: number }).limit)
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
  }
}
