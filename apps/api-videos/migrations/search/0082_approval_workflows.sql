-- Approval workflows (wiki AUN-WORKFLOWS §7, decision O44): change requests for sensitive admin changes.
-- Written by admin-api (lib/workflows). Account ids only: no emails or names (names come from the
-- batched name lookup). Every query has an index below; none scans a table.

-- Rule versions, append-only. The rule in force for (action_type, scope) is the highest version;
-- an action type with no row uses its default from shared-types (WORKFLOW_ACTIONS).
CREATE TABLE IF NOT EXISTS workflow_rules (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL CHECK (version >= 1),
  -- JSON WorkflowRuleConfig, validated against the action's floor before it is written
  config TEXT NOT NULL,
  -- the approved workflows.rule.set request (null for a seed)
  request_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_rules_version ON workflow_rules (action_type, scope, version);
CREATE TRIGGER IF NOT EXISTS workflow_rules_no_update BEFORE UPDATE ON workflow_rules BEGIN SELECT RAISE(ABORT, 'workflow_rules is append-only'); END;
CREATE TRIGGER IF NOT EXISTS workflow_rules_no_delete BEFORE DELETE ON workflow_rules BEGIN SELECT RAISE(ABORT, 'workflow_rules is append-only'); END;

-- One row per change request. Status changes only through compare-and-set on `version`; the history
-- is in workflow_steps.
CREATE TABLE IF NOT EXISTS workflow_requests (
  id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL CHECK (domain IN ('money', 'platform', 'people', 'governance')),
  -- the rule version in force when proposed (JSON snapshot, so later rule edits don't change it)
  rule_id TEXT,
  rule TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  -- action_type:target_kind:target_id while the request is open, else NULL: one open request per target
  open_key TEXT,
  subject_user_id TEXT,
  payload TEXT NOT NULL,
  -- JSON { title: {en, ar}, fields: WorkflowField[] }
  diff TEXT NOT NULL,
  base_version TEXT NOT NULL,
  reason TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'applying', 'applied', 'failed', 'rejected', 'withdrawn', 'expired', 'stale')),
  approvals_needed INTEGER NOT NULL CHECK (approvals_needed >= 0),
  approvals_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  applied_at TEXT,
  result TEXT,
  error TEXT,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_requests_open ON workflow_requests (open_key) WHERE open_key IS NOT NULL;
-- cron: pending requests past expiry (an approved change applies at once: no scheduled dates, WF-D6)
CREATE INDEX IF NOT EXISTS idx_workflow_requests_expiry ON workflow_requests (status, expires_at);
-- lists: by action, by proposer, by target, all by status
CREATE INDEX IF NOT EXISTS idx_workflow_requests_action ON workflow_requests (action_type, proposed_at);
CREATE INDEX IF NOT EXISTS idx_workflow_requests_status ON workflow_requests (status, proposed_at);
CREATE INDEX IF NOT EXISTS idx_workflow_requests_proposer ON workflow_requests (proposed_by, proposed_at);
CREATE INDEX IF NOT EXISTS idx_workflow_requests_target ON workflow_requests (target_kind, target_id, proposed_at);
CREATE INDEX IF NOT EXISTS idx_workflow_requests_proposed ON workflow_requests (proposed_at);

-- Every step on a request, append-only: the record of truth for the audit.
CREATE TABLE IF NOT EXISTS workflow_steps (
  request_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  -- an account id, or 'system' (expiry, apply, stale check)
  actor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('propose', 'approve', 'reject', 'withdraw', 'comment', 'apply', 'fail', 'expire', 'stale', 'retry')),
  note TEXT,
  step_up INTEGER NOT NULL DEFAULT 0,
  -- JSON request-origin record (lib/request-origin), null for system steps
  origin TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (request_id, seq)
) WITHOUT ROWID;
-- one approval per person per request, enforced by the database
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_steps_one_approval ON workflow_steps (request_id, actor) WHERE kind = 'approve';
CREATE INDEX IF NOT EXISTS idx_workflow_steps_actor ON workflow_steps (actor, at);
CREATE TRIGGER IF NOT EXISTS workflow_steps_no_update BEFORE UPDATE ON workflow_steps BEGIN SELECT RAISE(ABORT, 'workflow_steps is append-only'); END;
CREATE TRIGGER IF NOT EXISTS workflow_steps_no_delete BEFORE DELETE ON workflow_steps BEGIN SELECT RAISE(ABORT, 'workflow_steps is append-only'); END;

-- Open request × eligible approver: "Waiting for me" and the sidebar count are index lookups.
CREATE TABLE IF NOT EXISTS workflow_inbox (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_workflow_inbox_request ON workflow_inbox (request_id);
CREATE INDEX IF NOT EXISTS idx_workflow_inbox_user ON workflow_inbox (user_id, created_at);

-- Approver resolution reads the current finance list (approved, not removed) without a scan.
CREATE INDEX IF NOT EXISTS idx_support_finance_active ON support_finance_members (user_id) WHERE removed_at IS NULL AND approved_by IS NOT NULL;
