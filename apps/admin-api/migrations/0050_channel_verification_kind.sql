-- Migration: scholar label kind on the verification audit (wiki Epic 21 §4 21.3, owner decision E21-D4)
-- Admins grant the label as a scholar or an institution, with a required reason (the note).
ALTER TABLE channel_verification_log ADD COLUMN kind TEXT;
