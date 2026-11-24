# Account events from Auth

Auth tells Videos when an account is disabled, restored or erased, so that Videos hides, shows or erases its content too.
Auth's side: AlUmmahNowAuth `docs/account-hub/SPEC.md` §5.4 and AlUmmahNowAuth#507. This is step C3.

**Off by default**: the switch `accountEvents` (admin > Features, Super Admin). While it is off,
`POST /webhooks/auth/account-events` answers `404 feature_off`. `ageRules` can't be turned on until an event arrived in
the last 48 hours (`lastAccountEventAt`), which is why this is a switch of its own.

## Receiving

`POST /webhooks/auth/account-events`, `application/secevent+jwt`: one Security Event Token (RFC 8417) per request
(`lib/account-events/set.ts`). It is checked against Auth's JWKS: the issuer, the audience (`ClientId`, the **API Videos**
machine client), `typ` `secevent+jwt`, an `iat` in the last hour, a `jti`, a `seq` and exactly one event we know. An access
token can't pass as one.

| Answer | When | Auth |
|---|---|---|
| `202` | received, or received before (same `jti`) | done |
| `400` `{ err, description }` | refused for good (RFC 8935 codes), or an event Videos does nothing for yet | keeps it as failed; an admin can send it again |
| `404` `feature_off` | the switch is off | tries again, then keeps it as failed |
| `503` | the keys, D1 or the queue could not be reached | tries again |

Each valid event is a row in `account_events_received` (search D1, migration 0134) and moves
`account_event_status.last_valid_at`. A row holds a user id and a type, never an email, a name or an age. A `verification`
event is done once recorded.

## Doing

Events run on their own queue, `al-ummah-now-account-events[-qa|-stage]` (`lib/account-events/jobs.ts`). `202` means
received, not done, so the **worker** decides whether an event still applies:

- **One conditional write per account** (`account_event_users`) takes the account for an event only when it is newer (`seq`) than
  the last one applied. An older one is ignored, also when a failed hide is retried after a later restore. Nothing
  follows `account-purged`.
- **One event at a time works on an account** (a lease, longer than a queue invocation may run).
- An action (`ACCOUNT_ACTIONS`) is idempotent and resumable: with `complete: false` it goes on in a new message from its `progress`.
- A failure is retried with a backoff. After six tries the event is `failed` and an item on the admin Errors page, whose
  **Try again** queues it again (`POST /internal/account-events/retry`).
- The hourly sweep queues events whose message was lost, and removes settled ones after 35 days. Failed ones stay.

Events received before the switch was turned off are still finished.

## Steps

| Step | What |
|---|---|
| C3a | This: receiving, the order of events, the queue. No action yet, so only `verification` is accepted |
| C3b | `account-purged` erases the account's data |
| C3c | `account-disabled` hides, `account-enabled` puts back exactly what was hidden |
| C4 (Auth) | Subscribes **API Videos**, per environment |
