# Payments (wiki AUN-SUBS)

Creator tiers are the plans. While no payment provider is enabled, `/upgrade` stays the
request form (wiki AUN-TIER-REQUESTS) and nothing here runs. Once an admin enables a
provider and gives a tier a price, that tier's card on `/upgrade` shows the price and a
Subscribe button. The provider's webhook then assigns the tier automatically. A tier set to
"By request only" is never sold, even if it has a price.

Everything is off by default: no provider is enabled and no tier has a price.

## Providers

| Provider | Id | Role | Currencies | Portal | Partial refunds | Cancel at period end |
|---|---|---|---|---|---|---|
| Paddle | `paddle` | Merchant of record (collects and remits VAT/sales tax) | many | yes | yes | yes |
| PayGood | `paygood` | Merchant processor | USD, CAD | no | yes | no: billing stops at once; we keep access until the paid period ends |
| Test provider | `fake` | QA and the local stack only, never production | USD, EUR, GBP, SAR, AED, CAD | no | yes | yes |
| Comp | `manual` | An admin grants a tier for free (no provider) | n/a | n/a | n/a | n/a |

Stripe is not used (decision T2/O4 in the wiki: "never Stripe"). Both real adapters sit
behind one interface (`apps/api-videos/src/lib/billing/provider.ts`), which covers:
- checkout
- webhook signature check and event mapping
- subscription status
- cancel and refund
- customer portal
- price sync

Adding a provider means adding one adapter, plus its entry in `PAYMENT_PROVIDERS`
(`packages/shared-types/src/billing.ts`).

## Admin: Payments page (videos admin → Payments)

| Area | Permission | Who |
|---|---|---|
| See everything | `billing:read` | admins, super admins |
| Prices, tax details, sale mode per tier, cancel, grant a complimentary tier | `billing:manage` | admins, super admins |
| Providers: credentials, enable, test/live | `billing:providers` | super admins |
| Refunds | `billing:refund` | super admins |

- Every change is written to the admin audit log with the values it replaced. Credential
  changes record which credential changed and who changed it, never the value.
- Credentials, enabling a provider, refunds, cancels and comps need a step-up (a recent
  sign-in; `apps/admin-api/src/middleware/step-up-routes.ts`).
- Credentials are write-only. The page shows only "Set" or "Not set". admin-api writes the
  value to Cloudflare Secrets Store (`apps/admin-api/src/lib/billing-secrets.ts`); it is
  never stored in D1, logged or returned. Clearing a credential writes `unset`, because a
  Worker whose binding names a deleted secret fails to deploy.
- A provider can't be enabled while anything it needs is missing (`missing[]` on the page).

## Flow

1. **Checkout.** `/upgrade` → `POST /api/me/billing/checkout`. api-videos creates a checkout row,
   then gets either a Paddle transaction (opened with Paddle.js) or a hosted checkout URL
   (PayGood, the test provider).
2. **Webhook.** `POST /webhooks/billing/:provider`:
   - The signature is checked on the raw body (Paddle `Paddle-Signature`; PayGood
     `Merchant-Webhook-*`, 5-minute window; test `X-Fake-Signature`).
   - The event is stored once in `billing_events`. `(provider, mode, event_id)` is the
     idempotency key, so a redelivery stores nothing new.
   - It is queued as an admin job (`billing.webhook`) and the provider gets a 200.
   - A failure before the event is stored answers 503, and the provider redelivers.
3. **Job.**
   - It maps the event, applies it to `billing_subscriptions` and `billing_payments` (keyed by
     the provider's ids, so the job is idempotent too), and brings the user's tier in line.
   - An older event never moves the status back.
   - A payment that arrives before its subscription retries.
   - Transient errors retry with backoff and end in the DLQ.
   - An event that matches no user, or that the provider refuses for good, is marked failed and
     flagged on the admin **Errors** page with Retry. It does not retry by itself.
4. **Entitlement** (`syncEntitlement` in `apps/api-videos/src/lib/billing/store.ts`):
   - A subscription entitles while it is active, past due or canceled, and its access date is
     unset or in the future.
   - The best entitling tier is assigned with source `subscription`.
   - A higher or equal tier set by an admin is kept.
   - A lower admin tier is remembered and comes back when the subscription ends.
   - The super admin's automatic tier is never touched.
5. **Sweeps** (api-videos cron):
   - **Every 10 minutes**, the following end, and their users' tiers are brought in line:
     - comps past their date
     - canceled subscriptions whose paid period is over
     - subscriptions set to cancel at period end whose period is over (even if the provider's
       final event never arrives)
   - **Hourly**, any subscription whose renewal never arrived is checked with the provider
     (`billing.reconcile`).

Users see their subscriptions and billing history on `/settings/billing`. From there they can
cancel (at period end where the provider supports it) and, for Paddle, open the provider's
portal.

Account deletion keeps payment records as bookkeeping, but under the erased placeholder
instead of the user id. It empties webhook payloads and deletes customer links and checkouts
(`apps/processor/src/erasure/user-traces.ts`).

## Going live (production)

1. **Token for admin-api.** Create a Cloudflare API token with **Account → Secrets Store →
   Edit** for the al-ummah account. Store it in Secrets Store as `payments-secrets-token`.
   Then add this binding to `apps/admin-api/wrangler.jsonc`, in production and stage (and
   `wrangler.qa.jsonc` with `payments-secrets-token-qa` if QA should save credentials):
   ```jsonc
   { "binding": "PAYMENTS_SECRETS_TOKEN", "store_id": "f8eddc9944d041919ed8dc7d08d32308", "secret_name": "payments-secrets-token" }
   ```
   Until then the Payments page says credentials can't be saved there.
2. **Enter credentials.** A super admin enters the provider's credentials on the Payments
   page. They are saved to Secrets Store as `pay-<provider>-<api-key|webhook-secret>-<test|live>`,
   with `-qa` or `-stage` appended outside production.
3. **Bind them to api-videos.** Add the bindings in a config PR, to `apps/api-videos/wrangler.jsonc`
   (and stage/QA with their suffixed names). A binding to a secret that doesn't exist fails the
   deploy, which is why this comes after step 2:
   ```jsonc
   { "binding": "PAY_PADDLE_API_KEY_LIVE", "store_id": "f8eddc9944d041919ed8dc7d08d32308", "secret_name": "pay-paddle-api-key-live" },
   { "binding": "PAY_PADDLE_WEBHOOK_SECRET_LIVE", "store_id": "f8eddc9944d041919ed8dc7d08d32308", "secret_name": "pay-paddle-webhook-secret-live" }
   ```
4. **Set up the webhook.** In the provider's dashboard, add the webhook URL shown on the
   Payments page (`https://videos.api.alummahnow.net/webhooks/billing/<provider>`).
5. **Add prices and sync.** Add prices per tier, period and currency, then press **Sync
   prices**. This creates the products and prices at the provider, as a queued job with retry.
6. **Enable.** Turn the provider on (test mode first, then live).

## Tests

- **Unit:**
  - `apps/api-videos/test/billing.spec.ts`: signatures (including PayGood's worked example), the
    full test-provider flow, idempotency, ordering, entitlement, sweeps, cancel, refund and comps.
  - `apps/admin-api/test/billing.test.ts`: permissions, audit, credentials never stored or
    returned, step-up, and Retry permissions.
  - `apps/processor/src/__tests__/user-traces-erase.test.ts`: erasure.
- **E2E:** the local stack runs api-videos with `PAYMENTS_FAKE_PROVIDER=1`. Specs subscribe with
  the test provider's checkout page (`data-testid="fake-pay"`), so no real charges are made.
  `pnpm check:config` refuses `PAYMENTS_FAKE_PROVIDER` in production.

## Cost

No new Workers, queues or databases. Webhooks and admin actions reuse the admin-jobs queue, and
the sweeps reuse the existing 10-minute and hourly crons, so idle running cost is a few D1 reads
per cron run. Provider fees are per transaction, charged by the provider.
