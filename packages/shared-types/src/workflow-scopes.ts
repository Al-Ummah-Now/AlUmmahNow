/**
 * Scope names for people. Its own module because feature switches are named in the feature registry,
 * and `workflows.ts` imports nothing at run time (its tests run on plain Node).
 */
import { featureDefinition, isFeatureKey } from './feature-registry';
import { workflowScopeLabel, type WorkflowActionType, type WorkflowLocalized } from './workflows';

/** A scope's name, feature switches included (null: show the scope as it is). */
export function workflowScopeName(type: WorkflowActionType, scope: string): WorkflowLocalized | null {
  if (type === 'features.set' && isFeatureKey(scope)) return featureDefinition(scope).name;
  return workflowScopeLabel(type, scope);
}
