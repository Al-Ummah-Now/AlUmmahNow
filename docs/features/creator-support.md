# Supporting creators (wiki AUN-MEMBERS)

Viewers give a creator a one-time or monthly gift. **PayGood only collects** into the
organisation's merchant account; creators are paid through a **separate payout rail**. The
platform takes 0%. Spec: AlUmmahNowWiki `epics/AUN-MEMBERS-creator-support.md` (Linear AUN-612).

**Status: built behind a switch that is OFF everywhere.** It stays off until the organisation
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
| The `creatorSupport` switch seam and readiness | `switch.ts` |
| Ledger and posting builders | `ledger.ts` |
| Settings and owner decisions (`support_config`) | `config.ts` |
| Erasure | `apps/processor/src/erasure/user-traces.ts` (support rows kept as records under the erased marker; messages, payloads, open checkouts and finance membership removed) |

## Owner decisions are settings, never code

Every open decision is a field of `SupportPolicy`, stored in `support_config.policy` and read as
`null` until recorded. `creatorSupport` can't be switched on while any is null
(`supportReadiness`), and code paths that depend on one refuse with `decision_open` instead of
guessing.

| Decision | Policy fields | Code that reads it |
|---|---|---|
| MEM-D17 payout rail | `primaryRail`, `fallbackRail` | `adapters.ts` `railForPayee` |
| MEM-D18 hold | `holdDays` | release job (MEM-23) |
| MEM-D19 threshold and schedule | `payoutThresholdUsdMinor`, `payoutDayOfMonth`, `creatorMayRaiseThreshold` | payout plan job (MEM-23); `support_settings.payout_threshold` |
| MEM-D20 payout and FX fees | `payoutFeeBearer` | `ledger.ts` `payoutPaidLines` |
| MEM-D21 chargebacks after payout | `negativeBalancePolicy`, `reserveBasisPoints`, `reserveDays` | `ledger.ts` `debitCreator` (refunds, disputes) |
| MEM-D22 dormant balances | `dormantPolicy`, `dormantReminderMonths` | dormant job (MEM-4) |
| MEM-D23 gifts before payee active | `collectBeforePayeeActive` | server checks (MEM-5) |
| MEM-D24 approvals | `batchApprovers`, `adjustmentApprovers` | `switch.ts` `supportReadiness`; batch approval and adjustments (MEM-8, MEM-23) |
| MEM-D3 card fee payer | `collectorFeePayer` | `effectiveCoverFees` (shared-types) |
| MEM-D4 minimum and presets | `minimumUsdMinor`, `presetsUsdMinor` | support sheet (MEM-7) |
| MEM-D9 ages | `minSupporterAge`, `minCreatorAge` | server checks (MEM-5) |

## Tests

- `packages/shared-types/test/support.test.ts`: money, rounding, the breakdown (0% platform,
  covering fees), policy parsing.
- `apps/api-videos/test/support-adapters.spec.ts`: test collector and rail, idempotency, refusal
  of real vendors and of the test adapters in production.
- `apps/api-videos/test/support-ledger.spec.ts`: real SQL on the search migrations: postings,
  append-only triggers, idempotency, balances, MEM-D20/D21 as parameters, settings writes.
- `apps/processor/src/__tests__/user-traces-erase.test.ts`: erasure of support rows.
