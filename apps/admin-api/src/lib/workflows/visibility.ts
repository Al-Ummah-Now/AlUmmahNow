/**
 * Who may read approval requests (wiki AUN-WORKFLOWS §8): one rule for the pages and for the emails
 * that carry the same content.
 */
import { hasContentPermission, workflowDomainVisible, type WorkflowActor } from '@al-ummah/shared-types';
import { hasAdminRole } from '../roles';

type Reader = Pick<WorkflowActor, 'roles' | 'financePermissions'>;

/** Admins and finance-list members see the pages. */
export const mayReadWorkflows = (who: Reader): boolean => hasAdminRole(who.roles) || who.financePermissions.length > 0;

/** Who sees money requests: the finance list and support:read. */
export const readerSeesMoney = (who: Reader): boolean => who.financePermissions.length > 0 || hasContentPermission(who.roles, 'support:read');

/** Whether someone may read a request, by the domain stored with it. */
export const mayReadRequest = (who: Reader, domain: string): boolean => mayReadWorkflows(who) && workflowDomainVisible(domain, readerSeesMoney(who));
