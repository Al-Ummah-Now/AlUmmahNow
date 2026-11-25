/**
 * How the admin shows an audit row (issues #711, #745): the action as words in the admin's
 * language, the actor and items by name, and every id-valued detail as the thing it names. No
 * React here, so it is tested without a browser (test/audit-log.test.ts).
 */
import { auditRefKind, formatBillingAmount, isSystemActor, type AdminNames } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { providerName } from '@/components/payments/provider-name';
import { tierLabel } from '@/lib/creator-tiers';
import type { MessageKey, Translator } from '@/i18n/translate';
import en from '@/i18n/messages/en';

export type NamedKind = 'user' | 'channel' | 'video' | 'playlist' | 'post' | 'comment';

const ACTIONS = en.auditLog.actions as Record<string, string>;

/** `status.incident.create` → `status_incident_create`: the key form of an action. */
export const actionKey = (action: string) => action.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/**
 * The words for an action: its own label, else the label of its last part (`status.incident.edit`
 * reads "Edited"), else the action itself with its separators as spaces (a new action keeps
 * showing up until it gets words).
 */
export function actionLabel(action: string, t: Translator): string {
  const full = actionKey(action);
  if (full in ACTIONS) return t(`auditLog.actions.${full}` as MessageKey);
  const last = actionKey(action.split(/[.:]/).pop() ?? '');
  if (last in ACTIONS) return t(`auditLog.actions.${last}` as MessageKey);
  return action.replace(/[._:-]+/g, ' ').trim();
}

/** Where an item's admin page is; null for kinds without one. */
export function itemHref(kind: string, id: string): string | null {
  const e = encodeURIComponent(id);
  switch (kind) {
    case 'user':
      return `/users/${e}`;
    case 'channel':
      return `/channels/${e}`;
    case 'video':
      return `/videos/${e}`;
    case 'playlist':
      return `/playlists/${e}`;
    default:
      return null;
  }
}

export interface PersonView {
  id: string;
  /** What to show: the name, else the email, else "System" / "Unknown user" (never the id) */
  label: string;
  email: string | null;
  href: string | null;
  system: boolean;
  found: boolean;
  /** Nothing is known about this user: the label is "Unknown user" and the id is only in a copyable detail */
  unknown: boolean;
  /** No name: the label is the email (shown left to right, broken only at "@" and ".") */
  labelIsEmail?: boolean;
}

/**
 * A person by name (the display-name rule): the resolved display name (display name, else
 * first + last), then the email; the system actors read "System". Never a raw id and never an
 * @handle (handles belong to channels): with nothing known the label is "Unknown user" and
 * PersonName keeps the id in a copyable detail. `fallbackEmail` is the email the row itself
 * stored (actor_email, author_email…), for users without a videos profile.
 */
export function personView(id: string, names: AdminNames | null | undefined, t: Translator, fallbackEmail: string | null = null): PersonView {
  if (isSystemActor(id)) return { id, label: t('auditLog.system'), email: null, href: null, system: true, found: true, unknown: false };
  const named = names?.users[id];
  const email = named?.email?.trim() || fallbackEmail?.trim() || null;
  const name = named?.name?.trim() || '';
  const label = name || email || t('auditLog.unknownUser');
  return { id, label, email: name ? email : null, href: itemHref('user', id), system: false, found: !!named?.found, unknown: !name && !email, ...(!name && email ? { labelIsEmail: true } : {}) };
}

export interface ItemView {
  kind: string;
  id: string;
  label: string;
  href: string | null;
  found: boolean;
  /** A user nothing is known about ("Unknown user"; the id goes in a copyable detail) */
  unknown?: boolean;
}

/** An item by title; the id when it has no name (deleted, or not a kind the lookup knows). */
export function itemView(kind: string, id: string, names: AdminNames | null | undefined, t: Translator): ItemView {
  if (kind === 'user') {
    const p = personView(id, names, t);
    return { kind, id, label: p.label, href: p.href, found: p.found, unknown: p.unknown };
  }
  const named = names?.items[`${kind}:${id}`];
  return { kind, id, label: named?.title?.trim() || id, href: itemHref(kind, id), found: !!named?.found };
}

export type DetailView =
  | { key: string; type: 'ref'; item: ItemView }
  | { key: string; type: 'text'; value: string };

/** A detail's value as text: strings as they are, everything else as compact JSON. */
export const detailText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

/** A report's reason and status in words; every other value as it is. */
export function detailValue(key: string, value: unknown, t: Translator): string {
  if (typeof value === 'string' && (key === 'reason' || key === 'status') && Object.hasOwn(en[key], value)) return t(`${key}.${value}` as MessageKey);
  return detailText(value);
}

/** The details of a row, with ids replaced by what they name. */
export function detailViews(details: Record<string, unknown> | null | undefined, names: AdminNames | null | undefined, t: Translator): DetailView[] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([key, value]) => {
      const kind = auditRefKind(key, value);
      return kind ? { key, type: 'ref' as const, item: itemView(kind, value as string, names, t) } : { key, type: 'text' as const, value: detailValue(key, value, t) };
    });
}

/** Every id an entry list mentions, for one names request. */
export function namesRequestOf(entries: { actorId: string; target?: { kind: string; id: string } | null; details?: Record<string, unknown> | null }[]): { users: string[]; items: { kind: string; id: string }[] } {
  const users = new Set<string>();
  const items = new Map<string, { kind: string; id: string }>();
  const add = (kind: string, id: string) => {
    if (kind === 'user') users.add(id);
    else items.set(`${kind}:${id}`, { kind, id });
  };
  for (const e of entries) {
    if (e.actorId && !isSystemActor(e.actorId)) users.add(e.actorId);
    if (e.target) add(e.target.kind, e.target.id);
    for (const [key, value] of Object.entries(e.details ?? {})) {
      const kind = auditRefKind(key, value);
      if (kind) add(kind, value as string);
    }
  }
  return { users: [...users], items: [...items.values()] };
}

/** The audit page's URL for a set of filters (empty values dropped, the cursor last). */
export function auditHref(filters: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const key of ['actorId', 'itemKind', 'itemId', 'area', 'action', 'from', 'to', 'cursor']) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/audit?${query}` : '/audit';
}

/** A template cut at the named placeholders: text, then `{ slot }` where a node goes. Other placeholders stay text. */
export function splitTemplate(template: string, slots: string[]): (string | { slot: string })[] {
  return template
    .split(/(\{\w+\})/)
    .filter((part) => part !== '')
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return name && slots.includes(name) ? { slot: name } : part;
    });
}

const DETAIL_KEYS = en.auditLog.detailKeys as Record<string, string>;
const SETTINGS = en.auditLog.settings as Record<string, string>;

/** A detail's name in words ("New owner"); one without words yet keeps its key. */
export function detailKeyLabel(key: string, t: Translator): string {
  return key in DETAIL_KEYS ? t(`auditLog.detailKeys.${key}` as MessageKey) : key;
}

/** A setting's name in words: `notifications:menu-open` reads "Notification menu"; per-item settings (ops thresholds) keep their id after the name. */
export function settingLabel(setting: string, t: Translator): string {
  const full = actionKey(setting);
  if (full in SETTINGS) return t(`auditLog.settings.${full}` as MessageKey);
  const prefix = Object.keys(SETTINGS).find((k) => full.startsWith(`${k}_`));
  return prefix ? `${t(`auditLog.settings.${prefix}` as MessageKey)} (${setting.slice(setting.lastIndexOf(':') + 1)})` : setting;
}

/** A tier's two names, for the Payments lines. */
export type AuditTierNames = Record<string, { name: string; nameAr?: string | null }>;

const PAYMENT_PROVIDER_IDS = new Set(['paygood', 'fake', 'manual']);
const money = (amount: unknown, currency: unknown, locale: Locale): string => {
  if (typeof amount !== 'number' || typeof currency !== 'string') return '';
  // The shared price formatter: ٠–٩ and the currency's Arabic name in Arabic (never «US$»)
  return formatBillingAmount(amount, currency, locale === 'ar' ? 'ar' : 'en');
};

/**
 * A Payments row (area payments: admin-api billing.router.ts) as one sentence in the admin's
 * language: what happened and to which provider, price, subscription or user — never the raw
 * codes. `user` is a slot for the person's name (the caller renders it). Null for other rows.
 */
export function paymentsLine(
  entry: { action: string; target?: { kind: string; id: string } | null; details?: Record<string, unknown> | null },
  t: Translator,
  locale: Locale,
  tiers: AuditTierNames = {},
): { template: string; user: string | null; undone: boolean } | null {
  const kind = entry.target?.kind ?? '';
  const id = entry.target?.id ?? '';
  const d = entry.details ?? {};
  const undone = d.undo === true;
  const provider = PAYMENT_PROVIDER_IDS.has(id) ? providerName(t, id as never) : id;
  const tierName = (tierId: unknown) => {
    const tier = typeof tierId === 'string' ? tiers[tierId] : undefined;
    return tier ? tierLabel(tier, locale) : String(tierId ?? '');
  };
  const p = (key: string, params: Record<string, string> = {}) => t(`auditLog.payments.${key}` as MessageKey, params);
  if (kind === 'billing-provider') {
    if (entry.action === 'credential-set' || entry.action === 'credential-clear') {
      const field = d.field === 'webhookSecret' ? p('fields.webhookSecret') : p('fields.apiKey');
      const mode = d.mode === 'live' ? t('payments.modes.live') : t('payments.modes.test');
      return { template: p(entry.action === 'credential-set' ? 'keySaved' : 'keyRemoved', { field, provider, mode }), user: null, undone };
    }
    if (entry.action === 'sync-prices') return { template: p('pricesSynced', { provider }), user: null, undone };
    if (d.enabled === true) return { template: p('providerOn', { provider }), user: null, undone };
    if (d.enabled === false) return { template: p('providerOff', { provider }), user: null, undone };
    if (d.mode === 'test' || d.mode === 'live') return { template: p('providerMode', { provider, mode: t(`payments.modes.${d.mode}` as MessageKey) }), user: null, undone };
    if (d.settings) return { template: p('providerSettings', { provider }), user: null, undone };
    return { template: p('providerUpdated', { provider }), user: null, undone };
  }
  if (kind === 'billing-settings') return { template: p('taxSaved'), user: null, undone };
  if (kind === 'billing-price') {
    if (entry.action === 'delete') return { template: p('priceRemoved'), user: null, undone };
    const period = d.period === 'year' ? t('payments.periods.year') : t('payments.periods.month');
    return { template: p('priceSaved', { tier: tierName(d.tierId), period, amount: money(d.amount, d.currency, locale) }), user: null, undone };
  }
  if (kind === 'billing-subscription') return { template: p(entry.action === 'cancel-now' ? 'subscriptionEndedNow' : 'subscriptionEndsAtPeriodEnd'), user: null, undone };
  if (kind === 'billing-payment') return { template: p('refund'), user: null, undone };
  if (entry.action === 'billing-comp') {
    // On the user's own page the row has no target: the user is the page
    return kind === 'user' ? { template: p('comp', { tier: tierName(d.tierId), user: '{user}' }), user: id, undone } : { template: p('compHere', { tier: tierName(d.tierId) }), user: null, undone };
  }
  return null;
}
