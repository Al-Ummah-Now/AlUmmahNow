-- Dead letters keep hashed user ids (#1255). Expand-only: one new column.
-- 1 when the stored body had its user ids replaced by uh_<sha256> values at write time
-- (dlq/store.ts): such a row is kept for diagnosis only and cannot be replayed. Erasure steps
-- (UserDataErased, ContactDataErase) keep the raw id so a failed erasure can still finish.
ALTER TABLE dead_letters ADD COLUMN ids_hashed INTEGER NOT NULL DEFAULT 0;
