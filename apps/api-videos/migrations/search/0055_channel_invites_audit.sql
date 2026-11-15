-- Channel role invitations and the channel activity log
-- (docs/specs/CHANNEL-ROLES.md §5, §9).
--
-- Source data, like creator tiers and caption-minute grants: not rebuilt from
-- R2. Members themselves stay on the R2 channel record (`members`); an
-- accepted invitation adds the member there. Channel roles are not site roles
-- and never reach auth or tokens.
--
-- 0042: 0040 is taken by an open PR (live tiers) and 0041 is left for it.
-- Expand-only: new tables and indexes.

CREATE TABLE IF NOT EXISTS channel_invites (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'moderator')),
  invitee_user_id TEXT,
  invitee_email TEXT,                 -- normalized; cleared when the invitation closes
  invited_by TEXT NOT NULL,
  -- claimed: an accept in flight (between claiming the row and writing the role)
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  responded_at TEXT
);

-- One pending invitation per person per channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_invites_user ON channel_invites (channel_id, invitee_user_id) WHERE status = 'pending' AND invitee_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_invites_email ON channel_invites (channel_id, invitee_email) WHERE status = 'pending' AND invitee_email IS NOT NULL;
-- My invitations, by account or by email
CREATE INDEX IF NOT EXISTS idx_channel_invites_invitee_user ON channel_invites (invitee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_channel_invites_invitee_email ON channel_invites (invitee_email, status);
-- A channel's invitations (team page, limits), an inviter's (rate limit, cancel on removal), expiry
CREATE INDEX IF NOT EXISTS idx_channel_invites_channel ON channel_invites (channel_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_invites_inviter ON channel_invites (invited_by, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_invites_expiry ON channel_invites (status, expires_at);

CREATE TABLE IF NOT EXISTS channel_audit (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_user_id TEXT,
  old_role TEXT,
  new_role TEXT,
  created_at TEXT NOT NULL            -- never email addresses in any column
);

CREATE INDEX IF NOT EXISTS idx_channel_audit_channel ON channel_audit (channel_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_channel_audit_actor ON channel_audit (actor_id);
CREATE INDEX IF NOT EXISTS idx_channel_audit_target ON channel_audit (target_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_audit_created ON channel_audit (created_at);
