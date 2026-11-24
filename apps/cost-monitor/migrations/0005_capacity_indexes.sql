-- Indexes for the admin Databases section and the capacity emails (wiki AUN-D1-SCALING D1-1b):
-- every query they run seeks an index or a primary key, never scans a table.
CREATE INDEX IF NOT EXISTS idx_ops_thresholds_metric ON ops_thresholds (metric);
CREATE INDEX IF NOT EXISTS idx_ops_alerts_rule ON ops_alerts (rule_id);
-- queueCostEmails selects the subscribers of one kind; the primary key is (user_id, kind)
CREATE INDEX IF NOT EXISTS idx_cost_alert_subscriptions_kind ON cost_alert_subscriptions (kind);
