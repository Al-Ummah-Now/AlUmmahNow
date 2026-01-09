# Subscription Billing System Schema

## D1 Database Schema

```sql
CREATE TABLE user_subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL UNIQUE,
  tier_id TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active, canceled, past_due, paused
  current_period_start INTEGER NOT NULL,
  current_period_end INTEGER NOT NULL,
  cancel_at_period_end INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_subs_user ON user_subscriptions(user_id);
CREATE INDEX idx_subs_stripe ON user_subscriptions(stripe_subscription_id);

CREATE TABLE user_usage (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  storage_used INTEGER NOT NULL DEFAULT 0,
  videos_uploaded INTEGER NOT NULL DEFAULT 0,
  bandwidth_used INTEGER NOT NULL DEFAULT 0,
  transcription_minutes INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  live_stream_minutes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, period_start)
);
CREATE INDEX idx_usage_user_period ON user_usage(user_id, period_start);

CREATE TABLE overage_charges (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  usage_id TEXT NOT NULL REFERENCES user_usage(id),
  charge_type TEXT NOT NULL, -- storage, bandwidth, transcription, api_calls, live_stream
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  stripe_invoice_item_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, invoiced, paid
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_overage_user ON overage_charges(user_id);
CREATE INDEX idx_overage_status ON overage_charges(status);
```

## Tier Definitions

```typescript
const TIERS = {
  free: {
    id: 'free',
    name: 'Free',
    price_monthly_cents: 0,
    quotas: {
      storage_bytes: 1 * 1024**3,           // 1 GB
      videos_per_month: 5,
      bandwidth_bytes: 5 * 1024**3,          // 5 GB
      transcription_minutes: 30,
      api_calls_per_month: 1000,
      live_stream_minutes: 0,
      max_video_duration_seconds: 600,       // 10 min
      max_video_size_bytes: 500 * 1024**2    // 500 MB
    },
    overage_rates: { storage: 0, bandwidth: 0, transcription: 0, api: 0, livestream: 0 },
    features: ['basic_analytics', 'public_channel']
  },

  creator: {
    id: 'creator',
    name: 'Creator',
    price_monthly_cents: 999,
    quotas: {
      storage_bytes: 50 * 1024**3,           // 50 GB
      videos_per_month: 50,
      bandwidth_bytes: 100 * 1024**3,        // 100 GB
      transcription_minutes: 300,
      api_calls_per_month: 10000,
      live_stream_minutes: 120,
      max_video_duration_seconds: 3600,      // 1 hour
      max_video_size_bytes: 2 * 1024**3      // 2 GB
    },
    overage_rates: { storage: 10, bandwidth: 8, transcription: 5, api: 50, livestream: 3 },
    features: ['basic_analytics', 'public_channel', 'custom_thumbnails', 'scheduled_publishing']
  },

  professional: {
    id: 'professional',
    name: 'Professional',
    price_monthly_cents: 2999,
    quotas: {
      storage_bytes: 500 * 1024**3,          // 500 GB
      videos_per_month: 200,
      bandwidth_bytes: 1024 * 1024**3,       // 1 TB
      transcription_minutes: 1200,
      api_calls_per_month: 100000,
      live_stream_minutes: 600,
      max_video_duration_seconds: 14400,     // 4 hours
      max_video_size_bytes: 10 * 1024**3     // 10 GB
    },
    overage_rates: { storage: 8, bandwidth: 6, transcription: 4, api: 30, livestream: 2 },
    features: ['advanced_analytics', 'priority_encoding', 'custom_branding', 'api_access']
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price_monthly_cents: 9999,
    quotas: {
      storage_bytes: 5 * 1024**4,            // 5 TB
      videos_per_month: -1,                   // Unlimited
      bandwidth_bytes: 10 * 1024**4,         // 10 TB
      transcription_minutes: 6000,
      api_calls_per_month: -1,
      live_stream_minutes: 3000,
      max_video_duration_seconds: -1,
      max_video_size_bytes: 50 * 1024**3     // 50 GB
    },
    overage_rates: { storage: 5, bandwidth: 4, transcription: 3, api: 0, livestream: 1 },
    features: ['sso_integration', 'dedicated_support', 'sla_guarantee', 'white_label', 'team_management']
  }
};
```

## Stripe Webhook Handlers

```typescript
const WEBHOOK_HANDLERS = {
  // Subscription lifecycle
  'customer.subscription.created': 'handleSubscriptionCreated',
  'customer.subscription.updated': 'handleSubscriptionUpdated',
  'customer.subscription.deleted': 'handleSubscriptionDeleted',
  'customer.subscription.paused': 'handleSubscriptionPaused',
  'customer.subscription.resumed': 'handleSubscriptionResumed',

  // Payment events
  'invoice.payment_succeeded': 'handlePaymentSucceeded',
  'invoice.payment_failed': 'handlePaymentFailed',
  'invoice.created': 'handleInvoiceCreated',  // Add overage charges
  'invoice.upcoming': 'handleUpcomingInvoice',

  // Checkout
  'checkout.session.completed': 'handleCheckoutCompleted',
  'checkout.session.expired': 'handleCheckoutExpired'
};

// Key handler: Add overage charges to invoice
async function handleInvoiceCreated(db: D1Database, stripe: Stripe, event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  if (invoice.billing_reason !== 'subscription_cycle') return;

  const userId = await getUserIdFromCustomer(invoice.customer as string);
  const charges = await db.prepare(
    `SELECT * FROM overage_charges WHERE user_id = ? AND status = 'pending'`
  ).bind(userId).all();

  for (const charge of charges.results) {
    await stripe.invoiceItems.create({
      customer: invoice.customer as string,
      invoice: invoice.id,
      amount: charge.total_amount,
      currency: 'usd',
      description: `Overage: ${charge.charge_type}`
    });
    await db.prepare(`UPDATE overage_charges SET status = 'invoiced' WHERE id = ?`).bind(charge.id).run();
  }
}
```

## Quota Enforcement Logic

```typescript
async function checkQuota(db: D1Database, userId: string, quotaType: string, amount = 1) {
  const sub = await db.prepare(
    'SELECT tier_id FROM user_subscriptions WHERE user_id = ?'
  ).bind(userId).first();

  const tier = TIERS[sub?.tier_id || 'free'];
  const limit = tier.quotas[quotaType];
  if (limit === -1) return { allowed: true, current: 0, limit: -1, remaining: -1 };

  const now = Math.floor(Date.now() / 1000);
  const usage = await db.prepare(`
    SELECT * FROM user_usage WHERE user_id = ? AND period_start <= ? AND period_end > ?
  `).bind(userId, now, now).first();

  const current = usage?.[USAGE_MAPPING[quotaType]] || 0;
  const overageAllowed = tier.overage_rates[OVERAGE_MAPPING[quotaType]] > 0;

  return {
    allowed: current + amount <= limit || overageAllowed,
    current,
    limit,
    remaining: Math.max(0, limit - current),
    overage_allowed: overageAllowed
  };
}

async function recordUsage(db: D1Database, userId: string, quotaType: string, amount: number) {
  const now = Math.floor(Date.now() / 1000);
  const periodStart = getMonthStart(now);
  const periodEnd = getMonthEnd(now);

  await db.prepare(`
    INSERT INTO user_usage (user_id, period_start, period_end, ${quotaType})
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, period_start) DO UPDATE SET ${quotaType} = ${quotaType} + ?
  `).bind(userId, periodStart, periodEnd, amount, amount).run();

  await checkAndRecordOverage(db, userId, quotaType);
}

async function checkAndRecordOverage(db: D1Database, userId: string, quotaType: string) {
  const sub = await db.prepare('SELECT tier_id FROM user_subscriptions WHERE user_id = ?').bind(userId).first();
  const tier = TIERS[sub?.tier_id || 'free'];
  const limit = tier.quotas[quotaType];
  if (limit === -1) return;

  const now = Math.floor(Date.now() / 1000);
  const usage = await db.prepare(`
    SELECT id, ${quotaType} as val FROM user_usage WHERE user_id = ? AND period_start <= ? AND period_end > ?
  `).bind(userId, now, now).first();

  if (!usage || usage.val <= limit) return;

  const overage = usage.val - limit;
  const unitPrice = tier.overage_rates[OVERAGE_MAPPING[quotaType]];
  if (unitPrice === 0) return;

  const totalAmount = calculateOverageAmount(quotaType, overage, unitPrice);

  await db.prepare(`
    INSERT INTO overage_charges (user_id, usage_id, charge_type, quantity, unit_price, total_amount)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET quantity = ?, total_amount = ?
  `).bind(userId, usage.id, quotaType, overage, unitPrice, totalAmount, overage, totalAmount).run();
}

// Pre-upload validation
async function validateUpload(db: D1Database, userId: string, fileSize: number, duration: number) {
  const errors = [];
  const sub = await db.prepare('SELECT tier_id FROM user_subscriptions WHERE user_id = ?').bind(userId).first();
  const tier = TIERS[sub?.tier_id || 'free'];

  if (fileSize > tier.quotas.max_video_size_bytes)
    errors.push(`File exceeds ${tier.quotas.max_video_size_bytes / 1024**3}GB limit`);

  if (tier.quotas.max_video_duration_seconds !== -1 && duration > tier.quotas.max_video_duration_seconds)
    errors.push(`Duration exceeds ${tier.quotas.max_video_duration_seconds / 60}min limit`);

  const uploadCheck = await checkQuota(db, userId, 'videos_per_month');
  if (!uploadCheck.allowed) errors.push('Monthly upload limit reached');

  const storageCheck = await checkQuota(db, userId, 'storage_bytes', fileSize);
  if (!storageCheck.allowed && !storageCheck.overage_allowed) errors.push('Storage limit reached');

  return { valid: errors.length === 0, errors };
}

// Middleware
function quotaGuard(quotaType: string) {
  return async (c: Context, next: Next) => {
    const userId = c.get('userId');
    const result = await checkQuota(c.env.DB, userId, quotaType);
    if (!result.allowed) return c.json({ error: 'Quota exceeded' }, 429);
    await next();
  };
}

// Mappings
const USAGE_MAPPING = {
  storage_bytes: 'storage_used',
  videos_per_month: 'videos_uploaded',
  bandwidth_bytes: 'bandwidth_used',
  transcription_minutes: 'transcription_minutes',
  api_calls_per_month: 'api_calls',
  live_stream_minutes: 'live_stream_minutes'
};

const OVERAGE_MAPPING = {
  storage_bytes: 'storage',
  bandwidth_bytes: 'bandwidth',
  transcription_minutes: 'transcription',
  api_calls_per_month: 'api',
  live_stream_minutes: 'livestream'
};

function calculateOverageAmount(type: string, overage: number, unitPrice: number): number {
  if (type === 'storage_bytes' || type === 'bandwidth_bytes') return Math.ceil(overage / 1024**3) * unitPrice;
  if (type === 'api_calls_per_month') return Math.ceil(overage / 1000) * unitPrice;
  return overage * unitPrice;
}

function getMonthStart(ts: number): number {
  const d = new Date(ts * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
}

function getMonthEnd(ts: number): number {
  const d = new Date(ts * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000);
}
```
