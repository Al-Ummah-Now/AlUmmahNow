/**
 * Scope names for people. Its own module because feature switches are named in the feature registry,
 * and `workflows.ts` imports nothing at run time (its tests run on plain Node).
 */
import { featureDefinition, isFeatureKey } from './feature-registry';
import { WORKFLOW_ACTIONS, WORKFLOW_LISTED_SCOPES, WORKFLOW_SEEDED_SCOPES, workflowScopeLabel, type WorkflowActionType, type WorkflowLocalized } from './workflows';

/** A scope's name, feature switches included (null: show the scope as it is). */
export function workflowScopeName(type: WorkflowActionType, scope: string): WorkflowLocalized | null {
  if (type === 'features.set' && isFeatureKey(scope)) return featureDefinition(scope).name;
  return workflowScopeLabel(type, scope);
}

/**
 * Whether a rule can be made for this scope: a feature in the registry, or one of the action's own scopes
 * (an action without a list takes any). The default scope always is.
 */
export function workflowScopeKnown(type: WorkflowActionType, scope: string): boolean {
  if (!scope) return true;
  if (!WORKFLOW_ACTIONS[type].scoped) return false;
  if (type === 'features.set') return isFeatureKey(scope);
  const own = [...(WORKFLOW_LISTED_SCOPES[type] ?? []), ...(WORKFLOW_SEEDED_SCOPES[type] ?? [])];
  return !own.length || own.includes(scope);
}
