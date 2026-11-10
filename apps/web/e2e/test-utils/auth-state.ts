import * as fs from 'fs';
import * as path from 'path';
import type { BrowserContextOptions } from '@playwright/test';

/**
 * Storage-state files written by auth.setup.ts (global setup).
 * Use with `test.use({ storageState: AUTH_STATE.single })` to pin a spec to a
 * known user regardless of which Playwright project runs it.
 */
const AUTH_DIR = path.join(__dirname, '..', '.auth');

export const AUTH_STATE = {
  /** Profile + exactly one channel */
  single: path.join(AUTH_DIR, 'user-single.json'),
  /** Profile + two channels */
  multi: path.join(AUTH_DIR, 'user-multi.json'),
  /** Profile, no channels */
  none: path.join(AUTH_DIR, 'user-none.json'),
  /**
   * Profile + one fixed main channel. The only user specs may create (and
   * delete) extra channels on; every other user's channel set is fixed.
   */
  scratch: path.join(AUTH_DIR, 'user-scratch.json'),
  /** Signed in with NO profile and no channels (a newly registered user) */
  fresh: path.join(AUTH_DIR, 'user-fresh.json'),
} as const;

/** Explicitly logged-out state (overrides a project's storageState) */
export const ANONYMOUS_STATE = { cookies: [], origins: [] };

export type AuthUser = keyof typeof AUTH_STATE;

interface StoredCookie {
  name: string;
  value: string;
}

interface SessionChannel {
  id: string;
  name?: string;
  isMain?: boolean;
}

interface SessionCookieData {
  activeUserId: string;
  activeChannelId: string | null;
  accounts: Record<string, { email?: string; channels?: SessionChannel[]; activeChannelId?: string | null }>;
}

/**
 * Reads the al_ummah_session cookie of a stored user to learn its user id
 * and cached channels (used to build URLs to real QA data).
 */
export function readSession(user: AuthUser): { userId: string; activeChannelId: string | null; channels: SessionChannel[] } {
  const state = JSON.parse(fs.readFileSync(AUTH_STATE[user], 'utf8')) as { cookies: StoredCookie[] };
  const cookie = state.cookies.find((c) => c.name === 'al_ummah_session');
  if (!cookie) throw new Error(`No al_ummah_session cookie in ${AUTH_STATE[user]}`);
  let raw = cookie.value;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // not URI-encoded
  }
  const data = JSON.parse(raw) as SessionCookieData;
  const account = data.accounts[data.activeUserId];
  return {
    userId: data.activeUserId,
    activeChannelId: data.activeChannelId ?? account?.activeChannelId ?? null,
    channels: mainFirst(account?.channels ?? []),
  };
}

/** Main channel first, so `channels[0]` is always the user's main channel */
function mainFirst(channels: SessionChannel[]): SessionChannel[] {
  return [...channels].sort((a, b) => Number(!!b.isMain) - Number(!!a.isMain));
}

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

const SESSION_COOKIE = 'al_ummah_session';

function loadState(user: AuthUser): StorageState {
  return JSON.parse(fs.readFileSync(AUTH_STATE[user], 'utf8')) as StorageState;
}

function decodeSession(value: string): { data: Record<string, unknown> & SessionCookieData; encoded: boolean } {
  let raw = value;
  let encoded = false;
  try {
    const decoded = decodeURIComponent(value);
    encoded = decoded !== value;
    raw = decoded;
  } catch {
    // not URI-encoded
  }
  return { data: JSON.parse(raw), encoded };
}

/** Email, access token and channels of a stored user (for API calls and assertions) */
export function readAccount(user: AuthUser): {
  userId: string;
  email: string;
  accessToken: string;
  channels: SessionChannel[];
} {
  const cookie = loadState(user).cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error(`No ${SESSION_COOKIE} cookie in ${AUTH_STATE[user]}`);
  const { data } = decodeSession(cookie.value);
  const account = data.accounts[data.activeUserId] as { email?: string; accessToken?: string; channels?: SessionChannel[] };
  return {
    userId: data.activeUserId,
    email: account?.email ?? '',
    accessToken: account?.accessToken ?? '',
    channels: mainFirst(account?.channels ?? []),
  };
}

/**
 * Builds a storage state signed in to two accounts at once (the web app's
 * multi-account session), with `primary` active. Cached channel objects are
 * reduced to the fields the UI reads so the cookie stays under the 4KB limit.
 */
export function combinedSessionState(primary: AuthUser, secondary: AuthUser): StorageState {
  const base = loadState(primary);
  const other = loadState(secondary);
  const baseCookie = base.cookies.find((c) => c.name === SESSION_COOKIE);
  const otherCookie = other.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!baseCookie || !otherCookie) throw new Error(`Missing ${SESSION_COOKIE} cookie`);

  const { data, encoded } = decodeSession(baseCookie.value);
  const { data: otherData } = decodeSession(otherCookie.value);
  const slim = (account: Record<string, unknown>) => ({
    ...account,
    channels: ((account.channels as Array<Record<string, unknown>>) || []).map((c) => ({
      id: c.id,
      userId: c.userId,
      name: c.name,
      isMain: c.isMain,
    })),
  });
  const accounts: Record<string, unknown> = {};
  for (const [id, account] of Object.entries(data.accounts)) accounts[id] = slim(account as Record<string, unknown>);
  for (const [id, account] of Object.entries(otherData.accounts)) accounts[id] = slim(account as Record<string, unknown>);

  const json = JSON.stringify({ ...data, accounts });
  return {
    ...base,
    // Without the auth server's cookies: they hold only the primary user's
    // browser session, which every spec storing that user shares. Switching
    // accounts here posts the switch to the auth server, which left the
    // primary user inactive there, so every later spec on that user was
    // signed out once its stored token expired (no silent sign-in back).
    cookies: base.cookies
      .filter((c) => !isAuthServerCookie(c))
      .map((c) => (c.name === SESSION_COOKIE ? { ...c, value: encoded ? encodeURIComponent(json) : json } : c)),
  };
}

/** The auth server's own cookies (its browser session), by host or, on localhost, by name */
const AUTH_COOKIE_NAMES = new Set(['__session', 'oa_flow_bind']);
function isAuthServerCookie(cookie: { name: string; domain?: string }): boolean {
  const domain = (cookie.domain || '').replace(/^\./, '');
  const issuer = process.env.OPENAUTH_URL || '';
  let issuerHost = 'auth.qa.alummahnow.net';
  try {
    if (issuer) issuerHost = new URL(issuer).hostname;
  } catch {
    // keep the default
  }
  if (issuerHost === 'localhost' || issuerHost === '127.0.0.1') return AUTH_COOKIE_NAMES.has(cookie.name);
  return domain === issuerHost;
}
