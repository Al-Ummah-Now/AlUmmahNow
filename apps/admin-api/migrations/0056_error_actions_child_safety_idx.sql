-- NOT_CHILD_SAFETY checks error_actions per error_group (errors-store.ts, errors-queue.ts).
-- Without a partial index on child-safety keys, openActionCount scanned every action in a group
-- for every open action in that group (quadratic in group size).
CREATE INDEX IF NOT EXISTS idx_error_actions_child_safety
  ON error_actions (group_id)
  WHERE item_key GLOB 'child-safety-*' OR item_key GLOB 'csam[-:]*';
