# Supporting creators (wiki AUN-MEMBERS)

Viewers give a creator a one-time or monthly gift. **PayGood only collects** into the
organization's merchant account; creators are paid through a **separate payout rail**. The
platform takes 0%. Spec: AlUmmahNowWiki `epics/AUN-MEMBERS-creator-support.md` (Linear AUN-612).

**Status: built behind a switch that is OFF everywhere.** It stays off until the organization
exists and the lawyer, PayGood, Wise and PayPal have signed off. Nothing here can make a live
payment call: only the test collector and test rail exist, and only where
`SUPPORT_TEST_PROVIDERS=1` outside production.

Never Stripe (decision T2), including payout services built on Stripe.

## Money rules

- Amounts are integers in the currency's minor units, always with the ISO 4217 code
  (`Money` in `packages/shared-types/src/support.ts`). No float arithmetic: fees are integer
  basis points with explicit rounding (`divRound`, `basisPoints`), decimal input is parsed as text
  (`parseMajor`), and display formats the decimal string (`formatSupportMoney`, Arabic with ٠–٩
  and the currency's name).
- Every provider call takes an idempotency key (checkout id, refund key, payout id).
- The ledger (`support_ledger`, search migration 0076) is double entry and append-only: database
  triggers refuse UPDATE and DELETE; corrections are new entries. An entry is posted once per
  `entryKey` (`support_ledger_entries` primary key, same batch). Balances are sums, never stored.

## Code map

| Piece | Where |
|---|---|
| Money, policy (owner decisions), statuses, chart of accounts, permissions | `packages/shared-types/src/support.ts` |
| Collector interface (PayGood later, MEM-10) | `apps/api-videos/src/lib/support/collector.ts` |
| Payout rail interface (Wise / PayPal later, MEM-11) | `apps/api-videos/src/lib/support/rail.ts` |
| Test collector and test rail (no money) | `test-collector.ts`, `test-rail.ts`, state in `test-state.ts` / `d1-test-state.ts` |
| Which adapters exist here | `adapters.ts` (`collectorFor`, `railFor`, `railForPayee`) |
| The `creatorSupport` switch (AUN-FEATURES `feature_switches`, fails closed) and readiness; the Features page precondition is admin-api `lib/feature-preconditions.ts` | `switch.ts`, shared-types `support-readiness.ts` |
| Ledger and posting builders | `ledger.ts` |
| Settings and owner decisions (`support_config`) | `config.ts` |
| Erasure | `apps/processor/src/erasure/user-traces.ts` (support rows kept as records under the erased marker; messages, payloads, open checkouts and finance membership removed) |

## Webhooks, jobs and reconciliation (MEM-4)

- `POST /webhooks/support/:side/:vendor` (`side` = `collector` or `rail`): the signature is checked
  on the raw body, the event is stored once in `support_events` (`(vendor, mode, event_id)`
  unique), and the job `support.webhook` is queued. The route answers 200, 401 for a bad
  signature, 404 for a vendor not available here (every vendor in production today), and 503 when
  storing fails, so the vendor redelivers. Webhooks keep working while the switch is off: money
  already moving belongs to creators.
- The jobs run on the admin-jobs queue (retry, backoff, DLQ), in `lib/support/jobs.ts`:
  `support.webhook`, `support.release` (hourly), `support.reconcile`, `support.dispute-deadline`
  and `support.payee-sync` (daily at 01 UTC), and `support.dormant` (monthly). The crons queue
  nothing until support has data. A job that gives up flags the Errors page with Retry
  (`/internal/support/jobs/retry`, which needs `support:manage`). So does an event that depends on
  an open decision.
- `reconcile.ts`: the ledger against the collector's settlements, the bank statement the
  organization enters, and the rail's funding balance. A gap, or an entry that doesn't balance,
  stops new payout batches (`lastReconcileOk`; never reconciled counts as not clean).

## Payee onboarding (MEM-22)

`lib/support/payees.ts`, `endpoints/support/supportPayee.ts`:

- The channel's owner starts hosted onboarding at the payout rail with `POST /api/channels/:channelId/support/payee/onboard`, body `{ country, returnPath }`. The answer is the rail's link.
  - Identity, bank account or wallet, and the tax form (W-9 / W-8BEN) go straight to the rail.
  - We keep only the rail's payee reference, the status, the method's kind and which form is on file.
- `GET /api/channels/:channelId/support/payee` shows that state to the owner and the channel's admins.
- `POST .../payee/refresh` re-reads it from the rail.
- Every route answers `404 feature_off` while `creatorSupport` is off.
- Refused while MEM-D17 is open, for countries the Countries page blocks, waitlists or limits to an external link, and for countries no rail reaches.
- One payee per channel, rail and mode, however often onboarding starts.
- A sanctions hold from the rail holds the payee's payouts and flags the admin. It never auto-releases.
- The test rail's onboarding page, for QA and the local stack only, is `/webhooks/support/rail/test/onboard/:ref`. The tester picks the outcome, and it goes through the signed rail webhook → `support.payee-sync`.

## Payouts (MEM-23)

`lib/support/payouts.ts`, with the jobs in `jobs.ts`:

- **Plan** (`support.payout-plan`). Runs monthly on the MEM-D19 payout day, or when an approver starts a run through `/internal/support/batches/plan`.
  - It takes every active, unheld payee with a tax form on file whose available USD balance reaches the threshold (the creator's own higher threshold if MEM-D19 allows one), and quotes the rail's fee.
  - It refuses while MEM-D17, D19, D20, D21 or D24 is open, while payouts are held, or after an unclean or missing reconciliation.
  - It refuses the MEM-D21 reserve option, which isn't built (#1762).
- **Approve** (`/internal/support/batches/:id/approve`). Only people on the finance list can approve, and MEM-D24 sets how many must.
  - With two approvers, the preparer can't approve their own batch.
  - A batch the system prepared needs both people.
  - The last approval queues the funding check.
- **Fund** (`support.payout-fund`). The rail's funding balance must cover the batch. Until it does, the Errors page says "Fund the payout service" and the job checks again every hour. It never moves bank money itself.
- **Send** (`support.payout-send`, one job per payout). The payout id is the rail's idempotency key.
  - The ledger moves available → in payout before the call.
  - A lost answer marks the payout `unknown`, and the retry asks the rail before sending anything.
  - A stopped batch, a held payee or a balance that dropped since planning cancels the payout without paying.
- **Status** (`support.payout-status`, every 6 hours while payouts are in flight). Paid, failed and returned payouts are booked, and failed ones put the money back.

## Server checks (MEM-5)

`lib/support/eligibility.ts` gives one answer each to `/api/me/features` and to every support API, so a hidden button and its API always agree. The keys are computed only while `creatorSupport` is on, so nothing is read while support is off.

- **`support`**: may this person support creators from here?
  - They're signed in.
  - The decisions the support sheet needs are recorded: MEM-D3, D4, D9 and D15.
  - There's no emergency stop, and a collector exists here.
  - Their country (`cf.country`) isn't blocked for supporters on the Countries page.
  - A native app (`X-AUN-Client`) qualifies only once MEM-D15 allows the apps.
  - With `?channelId=`: that channel can receive, and the caller isn't on its team.
- **`supportReceive`**: may this channel receive?
  - MEM-D5, D17 and D23 are recorded.
  - The channel exists and isn't suspended.
  - The owner switched support on, and no admin paused it.
  - The payee is active, clear of screening and has a tax form on file, unless MEM-D23 allows gifts before the payee is active. A screening hold always stops new gifts.
  - The payee's country is allowed for creators.
  - Under MEM-D5 `tierCapability`, the owner's tier has `supportReceive`.
  - Signed-out viewers also get this key, because they see the button and sign in first.

## Supporting a channel: the server side (MEM-7)

`lib/support/checkout.ts` and `endpoints/support/supportCheckout.ts`. Every route answers `404 feature_off` while the switch is off or the checks say no.

- `GET /api/channels/:channelId/support` returns what the sheet shows: presets (the channel's own, or the decided defaults), one-time and monthly, the minimum, whether "cover the fees" is offered (MEM-D3), the age, and the thank-you note.
- `GET .../support/quote?amount=&currency=USD&coverFees=1&lang=ar` returns the breakdown, including "Al Ummah Now takes $0.00", plus the same amounts as text in the asked language.
- `POST .../support/checkout` checks, in order:
  - the human check (Turnstile);
  - supporter and receiver eligibility; the channel's own team is refused;
  - the kind is open on the channel;
  - the minimum (MEM-D4) and USD only for now;
  - the age confirmation (MEM-D9);
  - for monthly, the consent "Charge me {amount} every month until I stop.", stored word for word in English or Arabic;
  - at most 10 checkouts per account per hour.

  It answers with the collector's hosted page, and the return URL gets `?support=<checkoutId>`.
- `PUT .../support/settings` is the owner's own on/off, kinds, presets (at or above the minimum) and thank-you note.
- `GET /api/me/support`, `GET /api/me/support/checkouts/:id` and `POST /api/me/support/pledges/:id/stop` cover Settings › Support. Stopping cancels at the collector first. A person with existing support can always see and stop it, even with the switch off.
- The test collector's hosted page, for QA and the local stack only, is `/webhooks/support/test/checkout/:id`. "Pay (test)" goes through the signed webhook to the ledger; "Cancel" leaves the checkout unpaid.

## Admin API and the finance list (MEM-8)

admin-api `/api/support/*` (`routers/support.router.ts`, `lib/support-finance.ts`). Every change needs a step-up and is audited (`support-*` audit kinds).

- **Reading** (overview, settings with the open decisions and readiness, batches, countries, the finance list) is for super admins (`support:read`) and for people on the finance list.
- **The finance list** is a two-person change.
  - A super admin proposes a person with their money permissions: `support:refund`, `support:disputes`, `support:payouts`, `support:ledger`, `support:providers`. A different super admin approves.
  - Nobody adds or approves themselves. Removal takes effect at once.
- **Tech staff** (search migration 0078, `support_tech_staff`) are never on the finance list.
  - The owner is a tech employee of the organization and is marked tech staff.
  - Marking someone removes them from the list at once.
  - Unmarking needs a different super admin from the one who marked them.
- **Money actions are for the finance list only.** A super admin role alone is not enough.
  - Recording owner decisions, the organization being formed, the emergency stop and holding all payouts need `support:providers`.
  - Planning, approving and stopping payout batches need `support:payouts`. api-videos checks the finance list again on approval.
- **Country rules** need `support:manage` (super admins).

## Owner decisions are settings, never code

Every open decision is a field of `SupportPolicy`, stored in `support_config.policy` and read as
`null` until recorded. `creatorSupport` can't be switched on while any is null
(`supportReadiness`), and code paths that depend on one refuse with `decision_open` instead of
guessing.

| Decision | Policy fields | Code that reads it |
|---|---|---|
| MEM-D17 payout rail | `primaryRail`, `fallbackRail` | `adapters.ts` `railForPayee`; `payees.ts` `startPayeeOnboarding`; `payouts.ts` `payoutDecisionsOpen` |
| MEM-D18 hold | `holdDays` | `events.ts` (`available_at` stays empty while open) and `releaseDueGifts` |
| MEM-D19 threshold and schedule | `payoutThresholdUsdMinor`, `payoutDayOfMonth`, `creatorMayRaiseThreshold` | `payouts.ts` `planBatch`; `jobs.ts` `queueSupportCron` (payout day); `support_settings.payout_threshold` |
| MEM-D20 payout and FX fees | `payoutFeeBearer` | `ledger.ts` `payoutPaidLines`; `events.ts` `applyRailEvents` (paid, returned) |
| MEM-D21 chargebacks after payout | `negativeBalancePolicy`, `reserveBasisPoints`, `reserveDays` | `ledger.ts` `debitCreator` (refunds, disputes) |
| MEM-D22 dormant balances | `dormantPolicy`, `dormantReminderMonths` | `jobs.ts` `runSupportDormantJob` (lists only while open) |
| MEM-D23 gifts before payee active | `collectBeforePayeeActive` | `eligibility.ts` `receiverEligibility` |
| MEM-D24 approvals | `batchApprovers`, `adjustmentApprovers` | `supportReadiness` (finance list size); `payouts.ts` `approveBatch`; ledger adjustments (MEM-8) |
| MEM-D3 card fee payer | `collectorFeePayer` | `effectiveCoverFees` (shared-types) |
| MEM-D4 minimum and presets | `minimumUsdMinor`, `presetsUsdMinor` | support sheet (MEM-7) |
| MEM-D9 ages | `minSupporterAge`, `minCreatorAge` | `eligibility.ts` (must be recorded); the age confirmation on the support sheet (MEM-7) |
| MEM-D5 who may receive | `receiversRule` (+ `CreatorTier.supportReceive`) | `eligibility.ts` `receiverEligibility` |
| MEM-D15 apps | `appsEnabled` | `eligibility.ts` `supporterEligibility` (`X-AUN-Client`) |

## Tests

- `packages/shared-types/test/support.test.ts`: money, rounding, the breakdown (0% platform,
  covering fees), policy parsing.
- `apps/api-videos/test/support-adapters.spec.ts`: test collector and rail, idempotency, refusal
  of real vendors and of the test adapters in production.
- `apps/api-videos/test/support-ledger.spec.ts`: real SQL on the search migrations: postings,
  append-only triggers, idempotency, balances, MEM-D20/D21 as parameters, settings writes.
- `apps/api-videos/test/support-jobs.spec.ts`: signed webhooks through the queue to the ledger, redelivery, refunds and disputes, release, rail payout events, reconciliation, crons.
- `apps/api-videos/test/support-payouts.spec.ts`: plan, approve, fund, send, the lost-answer retry, stop, changed balances, failed payouts.
- `apps/api-videos/test/support-payees.spec.ts`: onboarding refusals, idempotency, the test onboarding page through the webhook, the sanctions hold, feature_off.
- `apps/api-videos/test/support-eligibility.spec.ts`: the `support` and `supportReceive` keys under the switch, the decisions, countries, apps, payee state and pauses.
- `apps/api-videos/test/support-checkout.spec.ts`: the sheet, the breakdown, the test checkout through the webhook to the ledger, monthly consent, stopping, the owner's settings, the refusals.
- `apps/web/e2e/release/support-flow.spec.ts` runs on the local stack (MEM-21), in the shared-state project because it turns the switch on. It covers:
  - the creator's payee onboarding at the test rail;
  - `/api/me/features`;
  - the breakdown;
  - a one-time and a monthly gift on the test collector's hosted page;
  - stopping the monthly gift;
  - `feature_off` with the switch off.

  It writes the settings and the switch with stack SQL and puts them back however it ends.
- `apps/processor/src/__tests__/user-traces-erase.test.ts`: erasure of support rows.
