-- Age rules (wiki E20 §5.2, E20-B2): the numbers an admin saved, and when the last valid account event from Auth
-- arrived (written by the receiver, E20-B6). One row each; neither holds anything about a person.
CREATE TABLE age_rules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE account_event_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_valid_at INTEGER NOT NULL
);
