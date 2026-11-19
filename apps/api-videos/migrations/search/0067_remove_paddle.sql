-- P1 decided (owner 2026-11-19): PayGood is the only payment provider, off until the owner enables it.
-- Paddle was removed from the code; drop any stored Paddle provider config and its price links
-- (nothing was live: no provider was ever enabled in production). Idempotent; expand-only otherwise.
DELETE FROM billing_price_links WHERE provider = 'paddle';
DELETE FROM billing_providers WHERE id = 'paddle';
