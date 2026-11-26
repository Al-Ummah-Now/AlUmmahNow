-- WF-D7: retain closed workflow requests and steps for seven years (money)
-- or two years (other domains) after their most recent activity.
CREATE INDEX idx_workflow_requests_retention ON workflow_requests (domain, updated_at)
  WHERE open_key IS NULL AND status IN ('applied', 'rejected', 'withdrawn', 'expired', 'stale');
CREATE INDEX idx_workflow_steps_retention ON workflow_steps (request_id, at);
CREATE INDEX idx_workflow_rules_request ON workflow_rules (request_id) WHERE request_id IS NOT NULL;

CREATE VIEW workflow_retention_candidates AS
  WITH candidates AS (
    SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 years') AS cutoff
    FROM workflow_requests
    WHERE open_key IS NULL AND status IN ('applied', 'rejected', 'withdrawn', 'expired', 'stale')
      AND domain = 'money' AND updated_at < cutoff
    UNION ALL
    SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 years') AS cutoff
    FROM workflow_requests
    WHERE open_key IS NULL AND status IN ('applied', 'rejected', 'withdrawn', 'expired', 'stale')
      AND domain IN ('platform', 'people', 'governance') AND updated_at < cutoff
  )
  SELECT id FROM candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM workflow_steps s WHERE s.request_id = c.id AND s.at >= c.cutoff
  )
  -- Rule evaluation uses the authorizing request's scope, including for superseded versions.
  AND NOT EXISTS (SELECT 1 FROM workflow_rules r WHERE r.request_id = c.id);

-- Commands are consumed by their own AFTER INSERT trigger. The authorization row
-- exists only within that statement, including on D1 where calls share no session.
CREATE TABLE workflow_retention_purges (request_id TEXT PRIMARY KEY) WITHOUT ROWID;
CREATE TABLE workflow_note_erasures (actor TEXT PRIMARY KEY CHECK (actor <> '' AND actor <> 'system')) WITHOUT ROWID;

DROP TRIGGER workflow_steps_no_update;
DROP TRIGGER workflow_steps_no_delete;

CREATE TRIGGER workflow_steps_no_update BEFORE UPDATE ON workflow_steps
WHEN NOT (
  EXISTS (SELECT 1 FROM workflow_note_erasures WHERE actor = OLD.actor)
  AND OLD.note IS NOT NULL AND NEW.note IS 'Removed'
  AND NEW.request_id IS OLD.request_id AND NEW.seq IS OLD.seq AND NEW.actor IS OLD.actor
  AND NEW.kind IS OLD.kind AND NEW.step_up IS OLD.step_up AND NEW.origin IS OLD.origin AND NEW.at IS OLD.at
)
BEGIN
  SELECT RAISE(ABORT, 'workflow_steps is append-only');
END;

CREATE TRIGGER workflow_steps_no_delete BEFORE DELETE ON workflow_steps
WHEN NOT EXISTS (SELECT 1 FROM workflow_retention_purges WHERE request_id = OLD.request_id)
BEGIN
  SELECT RAISE(ABORT, 'workflow_steps is append-only');
END;

-- REPLACE can otherwise delete a conflicting row without firing DELETE triggers
-- in SQLite. Protect both unique keys and reject steps after a request is purged.
CREATE TRIGGER workflow_steps_guard_insert BEFORE INSERT ON workflow_steps
BEGIN
  SELECT RAISE(ABORT, 'unknown workflow request')
  WHERE NOT EXISTS (SELECT 1 FROM workflow_requests WHERE id = NEW.request_id);
  SELECT RAISE(ABORT, 'workflow_steps is append-only')
  WHERE EXISTS (SELECT 1 FROM workflow_steps WHERE request_id = NEW.request_id AND seq = NEW.seq)
    OR (NEW.kind = 'approve' AND EXISTS (
      SELECT 1 FROM workflow_steps WHERE request_id = NEW.request_id AND actor = NEW.actor AND kind = 'approve'
    ));
END;

CREATE TRIGGER workflow_requests_guard_delete BEFORE DELETE ON workflow_requests
WHEN NOT EXISTS (SELECT 1 FROM workflow_retention_purges WHERE request_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'workflow_requests can only be deleted by retention');
END;

CREATE TRIGGER workflow_retention_purge AFTER INSERT ON workflow_retention_purges
BEGIN
  SELECT RAISE(ABORT, 'workflow request is ineligible for retention purge')
  WHERE NOT EXISTS (SELECT 1 FROM workflow_retention_candidates WHERE id = NEW.request_id);
  DELETE FROM workflow_steps WHERE request_id = NEW.request_id;
  DELETE FROM workflow_inbox WHERE request_id = NEW.request_id;
  DELETE FROM workflow_requests WHERE id = NEW.request_id;
  DELETE FROM workflow_retention_purges WHERE request_id = NEW.request_id;
END;

CREATE TRIGGER workflow_note_erase AFTER INSERT ON workflow_note_erasures
BEGIN
  UPDATE workflow_steps SET note = 'Removed'
    WHERE actor = NEW.actor AND note IS NOT NULL AND note <> 'Removed';
  UPDATE workflow_requests SET reason = 'Removed'
    WHERE proposed_by = NEW.actor AND reason <> 'Removed';
  DELETE FROM workflow_note_erasures WHERE actor = NEW.actor;
END;
