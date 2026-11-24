/**
 * Approval workflow engine types (wiki AUN-WORKFLOWS §8). A feature that governs a change registers one
 * executor per action type; routes call `proposeChange` instead of writing.
 */
import type { WorkflowActionType, WorkflowActor, WorkflowApproverSet, WorkflowField, WorkflowLocalized, WorkflowRuleConfig, WorkflowStatus, WorkflowStepKind } from '@al-ummah/shared-types';
import type { D1Database, D1PreparedStatement } from '../types';

/** Looks people up for the engine: who the actor is, and who may approve under a rule. */
export interface WorkflowDirectory {
  actor(userId: string, roles: readonly string[]): Promise<WorkflowActor>;
  /** Account ids matching any of `sets`, before exclusions (the engine applies those per person). */
  candidates(sets: readonly WorkflowApproverSet[]): Promise<string[]>;
  /** Facts for a candidate who isn't the person acting (roles from the staff list). */
  facts(userId: string): Promise<WorkflowActor>;
}

export interface WorkflowEvent {
  kind: 'proposed' | 'approved' | 'rejected' | 'withdrawn' | 'expired' | 'stale' | 'applied' | 'failed' | 'commented';
  requestId: string;
  type: WorkflowActionType;
  actor: string;
  /** People to tell: the proposer and the eligible approvers at the time. */
  recipients: string[];
}

export interface WorkflowCtx {
  /** The search D1, where the workflow tables live. */
  db: D1Database;
  directory: WorkflowDirectory;
  now: () => Date;
  /** Request-origin record for the step (lib/request-origin), when a person acts. */
  origin?: unknown;
  /** Whether the current request passed a step-up (the middleware ran). */
  steppedUp?: boolean;
  /** Called after each committed step; notifications and the audit mirror hang off it (WF-3, WF-4). */
  onEvent?: (event: WorkflowEvent) => Promise<void>;
  /** Whatever an executor needs from the environment (other bindings, clients). */
  env?: unknown;
}

export interface WorkflowDescription {
  title: WorkflowLocalized;
  fields: WorkflowField[];
  /** A fingerprint of the target's current value; the stale check compares it again before approval and apply. */
  baseVersion: string;
  /** The person the change is about (for example the account added to the finance list): never their own approver. */
  subjectUserId?: string | null;
}

export interface WorkflowStoredRequest {
  id: string;
  actionType: WorkflowActionType;
  scope: string;
  payload: unknown;
  proposedBy: string;
  /** Everyone who approved it, in order (empty for a direct rule). */
  approvedBy: string[];
  status: WorkflowStatus;
  version: number;
  proposedAt: string;
  /** How many times applying it has failed (more than none: this is a retry, and an earlier attempt may have made the change). */
  failedAttempts: number;
}

export interface WorkflowExecutor<P = unknown, R = unknown> {
  type: WorkflowActionType;
  /** The rule scope for this payload (for example the feature id); '' by default. */
  scope?(payload: P): string;
  target(payload: P): { kind: string; id: string };
  /** The feature's own permission to propose (the engine adds the money floor on top). */
  canPropose(ctx: WorkflowCtx, actor: WorkflowActor, payload: P): Promise<boolean>;
  /** Validates and normalizes the input; throws the feature's own errors. */
  validate(ctx: WorkflowCtx, input: unknown): Promise<P>;
  describe(ctx: WorkflowCtx, payload: P): Promise<WorkflowDescription>;
  currentVersion(ctx: WorkflowCtx, payload: P): Promise<string>;
  /**
   * applyJob only, asked on a retry whose target has changed: whether an earlier attempt of this request made
   * that change. Then applyJob runs again (and finishes what was left) instead of the request going stale.
   */
  alreadyApplied?(ctx: WorkflowCtx, payload: P, request: WorkflowStoredRequest): Promise<boolean>;
  /** Extra reasons this person may not approve, beyond the rule (for example: whoever marked someone as tech staff never approves removing the mark). */
  approverBlocks?(ctx: WorkflowCtx, payload: P, actorId: string): Promise<string[]>;
  /** A floor above the action's own (payout batches: MEM-D24). */
  minApprovals?(ctx: WorkflowCtx): Promise<number>;
  /** Search-D1 changes: statements the engine runs in one batch with the request's applied status. */
  applyStatements?(ctx: WorkflowCtx, payload: P, request: WorkflowStoredRequest): Promise<{ statements: D1PreparedStatement[]; result: R }>;
  /** Anything else: must be idempotent on request.id (it may run again after a failure or a crash). */
  applyJob?(ctx: WorkflowCtx, payload: P, request: WorkflowStoredRequest): Promise<R>;
}

export type { WorkflowRuleConfig, WorkflowStepKind };
