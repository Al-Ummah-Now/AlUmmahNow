import { z } from 'zod';
import { ENTITLEMENT_CATALOGUE } from '@al-ummah/shared-types';
import { AdminRoute, AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { hasAdminRole } from '../../lib/roles';
import { logger } from '../../lib/logger';
import * as plans from '../../lib/plans';

type Run = (c: AppContext, data: any, actor: plans.Actor) => Promise<plans.Outcome>;

/** Builds an admin-only route. The API-wide middleware also admits moderators, so this checks again. */
function endpoint(summary: string, request: Record<string, unknown>, run: Run): any {
  return class extends AdminRoute {
    schema = addAuthToSchema({
      tags: ['Plans'],
      summary,
      request,
      responses: { '200': { description: 'OK' }, '400': { description: 'Invalid' }, '403': { description: 'Admin role required' }, '404': { description: 'Not found' }, '409': { description: 'Conflict' } },
    });

    async handle(c: AppContext) {
      const userId = this.getUserId(c);
      if (!hasAdminRole(c.get('auth')?.roles)) {
        logger.warn('[Plans] Non-admin attempted plan management', { userId });
        return c.json({ success: false, error: 'Admin role required' }, 403);
      }
      const data = await this.getValidatedData<any>();
      const outcome = await run(c, data, { id: userId, now: new Date().toISOString(), newId: () => crypto.randomUUID() });
      if (outcome.ok === false) return c.json({ success: false, error: outcome.error }, outcome.status);
      return { success: true, result: outcome.result };
    }
  };
}

const json = (schema: z.ZodTypeAny) => ({ body: { content: { 'application/json': { schema } } } });
const id = z.object({ id: z.string() });
const subjectParam = z.object({ subject: z.string() });
const planFields = {
  name_en: z.string().min(1).max(100),
  name_ar: z.string().min(1).max(100),
  description_en: z.string().max(1000).nullable().optional(),
  description_ar: z.string().max(1000).nullable().optional(),
  is_public: z.boolean().optional(),
  sort_order: z.number().int().optional(),
};
const audience = z.enum(['creator', 'organisation', 'viewer', 'everyone']);
const reason = z.object({ reason: z.string().min(1).max(500) });

const withSubject = (run: (c: AppContext, data: any, actor: plans.Actor, subject: plans.SubjectRef) => Promise<plans.Outcome>): Run =>
  async (c, data, actor) => {
    const subject = plans.parseSubject(data.params.subject);
    if (!subject) return { ok: false, status: 400, error: 'Subject must be channel:{id} or user:{id}' };
    return run(c, data, actor, subject);
  };

export const CatalogueGet = endpoint('Entitlement catalogue', {}, async () => ({ ok: true, result: { catalogue: ENTITLEMENT_CATALOGUE } }));
export const PlansList = endpoint('List plans', {}, (c) => plans.listPlans(c.env));
export const PlanCreate = endpoint('Create or clone a plan', json(z.object({ slug: z.string(), audience, cloneFrom: z.string().optional(), ...planFields })), (c, d, a) => {
  const { cloneFrom, ...input } = d.body;
  return plans.createPlan(c.env, a, input, cloneFrom);
});
export const PlanGet = endpoint('Get a plan', { params: id }, (c, d) => plans.getPlan(c.env, d.params.id));
export const PlanUpdate = endpoint('Update plan details', { params: id, ...json(z.object({ ...planFields, name_en: planFields.name_en.optional(), name_ar: planFields.name_ar.optional() })) }, (c, d, a) => plans.updatePlan(c.env, a, d.params.id, d.body));
export const PlanValuesSet = endpoint('Replace editable entitlement values', { params: id, ...json(z.object({ values: z.record(z.unknown()) })) }, (c, d, a) => plans.setPlanValues(c.env, a, d.params.id, d.body.values));
export const PlanPublish = endpoint('Publish a plan version', { params: id }, (c, d, a) => plans.publishPlan(c.env, a, d.params.id));
export const PlanArchive = endpoint('Archive a plan', { params: id }, (c, d, a) => plans.archivePlan(c.env, a, d.params.id));
export const PlanMigrate = endpoint('Migrate subscribers to the published version', { params: id, ...json(z.object({ apply: z.boolean().default(false), reason: z.string().max(500).default('') })) }, (c, d, a) => plans.migrateSubscribers(c.env, a, d.params.id, d.body.apply, d.body.reason));
export const SubjectGet = endpoint("A subject's plan, overrides and usage", { params: subjectParam }, withSubject((c, _d, _a, s) => plans.getSubjectState(c.env, s)));
export const AssignmentSet = endpoint('Assign a plan or trial', { params: subjectParam, ...json(z.object({ planId: z.string(), status: z.enum(['active', 'trialing']).default('active'), expiresAt: z.string().nullable().optional(), reason: reason.shape.reason })) }, withSubject((c, d, a, s) => plans.assignPlan(c.env, a, s, d.body)));
export const AssignmentCancel = endpoint('Return a subject to the default plan', { params: subjectParam, ...json(reason) }, withSubject((c, d, a, s) => plans.cancelAssignment(c.env, a, s, d.body.reason)));
export const OverrideSet = endpoint('Set an entitlement override', { params: subjectParam, ...json(z.object({ key: z.string(), value: z.unknown(), expiresAt: z.string().nullable().optional(), reason: reason.shape.reason })) }, withSubject((c, d, a, s) => plans.setOverride(c.env, a, s, d.body)));
export const OverrideRemove = endpoint('Remove an entitlement override', { params: subjectParam, ...json(z.object({ key: z.string(), reason: reason.shape.reason })) }, withSubject((c, d, a, s) => plans.removeOverride(c.env, a, s, d.body.key, d.body.reason)));
export const AuditList = endpoint('Plan audit log', { query: z.object({ limit: z.coerce.number().int().default(100) }) }, (c, d) => plans.listAudit(c.env, d.query.limit));
