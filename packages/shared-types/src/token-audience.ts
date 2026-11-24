/**
 * Access-token audience (`aud`) allowlists (security audit 2026-11-14).
 *
 * Auth signs every client's access tokens with one key and sets `aud` to the OAuth client id that
 * obtained the token. openauth's `client.verify()` returns `aud` but never compares it, so a token
 * minted for any client was accepted by every service. Each service now names the clients whose
 * tokens it takes.
 *
 * Client ids come from Auth's client registry, never from a prod query:
 *   - production and stage: AlUmmahNowAuth apps/auth/migrations (stage's rows are seeded from them)
 *   - QA: AlUmmahNowAuth apps/auth/migrations-qa
 * and match what each app sends (web/admin-web wrangler ClientId, UI WWW_CLIENT_ID /
 * SITES_CLIENT_ID, CMS AUTH_CLIENT_ID, Android build.gradle.kts, Apple Configs/*.xcconfig,
 * Desktop AppEnvironment.cs). A new client means a new entry here.
 *
 * Rollout: AUD_MODE "log" (default) only logs a mismatch (client id and route, never the token);
 * "enforce" refuses it; "off" skips the check.
 */

export type FirstPartyClient =
  | 'web'
  | 'adminWeb'
  | 'www'
  | 'sites'
  | 'cms'
  | 'authProfile'
  | 'authAdmin'
  | 'viewerMobile'
  | 'viewerTv'
  | 'viewerDesktop'
  | 'studioMobile'
  | 'studioDesktop'
  | 'adminIos'
  | 'adminMac'
  | 'adminWindows'
  | 'adminAndroid'
  /** AlUmmahNowTools, the desktop admin import app (wiki TOOLS-ADMIN). */
  | 'adminTools';

export type AuthEnvironment = 'production' | 'qa';

/** Production and stage share ids (stage's oauth_clients are seeded from production's). */
export const FIRST_PARTY_CLIENT_IDS: Record<AuthEnvironment, Record<FirstPartyClient, string>> = {
  production: {
    web: 'f0de3c30-0304-4ac4-86d6-1e185dec0439',
    adminWeb: 'a24e39de-601d-463b-b50d-37a0a94e986b',
    www: 'd34701ed-03de-43f8-95a8-91cd1e1874bb',
    sites: '81f2bb95-15c6-4896-b414-be2c24155a74',
    cms: 'd06fd65a-5b79-45bc-8bfd-a856b8502330',
    authProfile: '109a1087-6626-40f7-8a7f-7f42f83f4f30',
    authAdmin: '1448ed27-39a6-417d-b4c8-07f881e81269',
    viewerMobile: '567a2cbc-dab8-4d5c-9437-a9e61c7120f5',
    viewerTv: '111648c6-24e6-4c35-8bcf-f50ab5c0d96d',
    viewerDesktop: 'f97abe68-ef61-41b6-bf08-d86650cc7cb3',
    studioMobile: '6f8073c6-754b-4d63-bf80-0546214e0d62',
    studioDesktop: '950e2b3b-6353-4472-affe-7c1f57f4e6a4',
    adminIos: '95adb86e-fdfb-4955-984b-347aa16a5023',
    adminMac: '6a65d365-1352-4ffa-922f-4053d461ac3a',
    adminWindows: '288b80b9-ecc6-4927-8b5a-bded5aa00e55',
    adminAndroid: '6634c4c9-a80d-4961-9427-d997349f8ea2',
    adminTools: 'cf0d26c6-4cd1-4bbf-8247-c63a5d417b15',
  },
  qa: {
    web: 'e0de3c30-0304-4ac4-86d6-1e185dec0439',
    adminWeb: 'b24e39de-601d-463b-b50d-37a0a94e986b',
    www: 'ecda6f18-89cb-415c-b746-7e77184d75a2',
    sites: '0abd9eac-e47e-4a1a-90bd-18cffec0303c',
    cms: '0e613f49-674b-490a-93e5-97a35d586da1',
    // Auth's profile app hard-codes 109a1087-... in every environment (AlUmmahNowAuth apps/profile/src/index.ts,
    // wrangler.qa.json PROFILE_CLIENT_ID, migrations-qa/0007_fix_profile_redirect_uris.sql); issuer verification
    // still separates QA and production tokens.
    authProfile: '109a1087-6626-40f7-8a7f-7f42f83f4f30',
    authAdmin: '2448ed27-39a6-417d-b4c8-07f881e81269',
    viewerMobile: '31389afb-d4f8-4c26-9492-4c77f4d07e65',
    viewerTv: '9c3a81c8-3f9c-4873-abb1-a51e4f1d9543',
    viewerDesktop: 'ce7de8a4-59dd-4682-ab4d-105399105294',
    studioMobile: '45364a42-21f4-4359-a76c-0a1e6615fd7b',
    studioDesktop: '29b4792a-caad-4814-a83f-4337bc6a1aeb',
    adminIos: '77330b47-5747-4058-ba00-921e159f1ced',
    adminMac: '1c230211-7b90-4d0a-be9d-3068ebd79d5b',
    adminWindows: '306b6f10-d9f0-4609-84a1-23c92da978e9',
    adminAndroid: '5b44a4f7-d369-4d12-bc69-028d0276604a',
    adminTools: '75f36653-4dfd-44af-8f67-588a5b7e9613',
  },
};

const NATIVE: FirstPartyClient[] = ['viewerMobile', 'viewerTv', 'viewerDesktop', 'studioMobile', 'studioDesktop', 'adminIos', 'adminMac', 'adminWindows', 'adminAndroid'];

/** The clients each service takes access tokens from. */
export const SERVICE_AUDIENCES = {
  /** The public API: the sites, www's profile read at sign-in, every native app; Admin Tools for its
   *  resumable uploads (TUS) to the sessions admin-api opened for it. */
  'api-videos': ['web', 'adminWeb', 'www', 'sites', ...NATIVE, 'adminTools'],
  /** The admin API: admin-web, the web server's Studio routes (site domains, contact), the native apps. */
  'admin-api': ['adminWeb', 'web', ...NATIVE, 'adminTools'],
  /** Realtime: the web and admin sites and the native apps. */
  'websocket-server': ['web', 'adminWeb', ...NATIVE],
  /** The web site checks only its own sessions' tokens. */
  web: ['web'],
  /** The admin site checks only its own sessions' tokens. */
  'admin-web': ['adminWeb'],
} as const satisfies Record<string, readonly FirstPartyClient[]>;

export type AudienceService = keyof typeof SERVICE_AUDIENCES;

/**
 * Extra clients a service takes on one route only (`METHOD /path`, exact). Kept narrow: the client
 * gets that route and nothing else of the service.
 */
export const ROUTE_AUDIENCES: Partial<Record<AudienceService, Readonly<Record<string, readonly FirstPartyClient[]>>>> = {
  'api-videos': {
    /** Auth's profile site: self-service /delete-account erases the signed-in user's Videos data
     *  before deleting their Auth account (AlUmmahNowAuth#532). */
    'DELETE /api/privacy/data': ['authProfile'],
  },
  'admin-api': {
    /** Auth's admin site: the Translate buttons on its en/ar fields (client names, theme texts) send the
     *  signed-in staff member's own token from its server; content:translate still decides (L10N). */
    'POST /api/translate/fields': ['authAdmin'],
  },
};
export type AudienceMode = 'off' | 'log' | 'enforce';

/** AUD_MODE: "enforce" and "off" by name; anything else (unset, typos) is "log". */
export function audienceMode(raw: string | undefined | null): AudienceMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'enforce' || v === 'off' ? v : 'log';
}

/** Which registry an issuer's tokens belong to; null for an issuer outside it (fail closed when enforcing). */
export function authEnvironmentOf(issuer: string | undefined | null): AuthEnvironment | null {
  let host: string;
  try {
    host = new URL(issuer ?? '').hostname;
  } catch {
    return null;
  }
  if (host === 'auth.qa.alummahnow.net') return 'qa';
  if (host === 'auth.alummahnow.net' || host === 'auth.stage.alummahnow.net') return 'production';
  // The local stack's Auth runs production's migrations (apps/auth/migrations)
  if (host === 'localhost' || host === '127.0.0.1') return 'production';
  return null;
}

/** The client ids `service` takes on `issuer`; empty when the issuer is unknown. */
export function allowedClientIds(service: AudienceService, issuer: string | undefined | null): string[] {
  const env = authEnvironmentOf(issuer);
  if (!env) return [];
  return SERVICE_AUDIENCES[service].map((name) => FIRST_PARTY_CLIENT_IDS[env][name]);
}

/** The extra client ids `service` takes on `route` (`METHOD /path`) on `issuer`; usually none. */
export function routeClientIds(service: AudienceService, route: string | undefined, issuer: string | undefined | null): string[] {
  const env = authEnvironmentOf(issuer);
  const names = route ? ROUTE_AUDIENCES[service]?.[route] : undefined;
  if (!env || !names) return [];
  return names.map((name) => FIRST_PARTY_CLIENT_IDS[env][name]);
}

/** The first-party name of a client id (for logs), or null. */
export function clientNameOf(clientId: string | undefined | null): string | null {
  if (!clientId) return null;
  for (const env of Object.keys(FIRST_PARTY_CLIENT_IDS) as AuthEnvironment[]) {
    for (const [name, id] of Object.entries(FIRST_PARTY_CLIENT_IDS[env])) if (id === clientId) return `${name}@${env}`;
  }
  return null;
}

export interface AudienceVerdict {
  /** False only when the token must be refused (enforce mode and a mismatch). */
  ok: boolean;
  /** True when `aud` is not one of the service's clients (logged in "log" and "enforce"). */
  mismatch: boolean;
  /** What to log on a mismatch: never the token. */
  log?: { event: 'aud_mismatch'; service: AudienceService; mode: AudienceMode; clientId: string | null; client: string | null; issuer: string | null; route?: string };
}

/**
 * Checks a verified token's `aud` against the service's clients. Call it only after the signature,
 * issuer and expiry were verified.
 */
export function checkAudience(input: {
  service: AudienceService;
  aud: unknown;
  issuer: string | undefined | null;
  mode: AudienceMode;
  route?: string;
}): AudienceVerdict {
  if (input.mode === 'off') return { ok: true, mismatch: false };
  const auds = Array.isArray(input.aud) ? input.aud.filter((a): a is string => typeof a === 'string') : typeof input.aud === 'string' ? [input.aud] : [];
  const allowed = [...allowedClientIds(input.service, input.issuer), ...routeClientIds(input.service, input.route, input.issuer)];
  if (auds.some((a) => allowed.includes(a))) return { ok: true, mismatch: false };
  const clientId = auds[0] ?? null;
  return {
    ok: input.mode !== 'enforce',
    mismatch: true,
    log: {
      event: 'aud_mismatch',
      service: input.service,
      mode: input.mode,
      clientId: clientId ? clientId.slice(0, 64) : null,
      client: clientNameOf(clientId),
      issuer: input.issuer ?? null,
      route: input.route?.slice(0, 200),
    },
  };
}

/** Error returned in place of a verify result whose `aud` is refused (enforce mode). */
export class AudienceMismatchError extends Error {
  constructor() {
    super('Token was issued to another client');
    this.name = 'AudienceMismatchError';
  }
}

/**
 * For a site's own `client.verify()` result: logs an `aud` mismatch and, in enforce mode, turns the
 * result into `{ err }`. Failed results pass through untouched.
 */
export function applyAudienceCheck<R extends { aud?: unknown; err?: unknown }>(
  result: R,
  ctx: { service: AudienceService; issuer: string | undefined | null; mode: AudienceMode; route?: string },
  warn: (message: string, fields: Record<string, unknown>) => void,
): R | { err: AudienceMismatchError } {
  if (!result || result.err) return result;
  const verdict = checkAudience({ ...ctx, aud: result.aud });
  if (verdict.log) warn('Access token audience is not one of this service\'s clients', verdict.log);
  return verdict.ok ? result : { err: new AudienceMismatchError() };
}

/**
 * A site's openauth client whose `verify()` also checks `aud` (applyAudienceCheck). The other
 * methods are the client's own. AUD_MODE is read on every call, so a vars change applies at once.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withAudienceCheck<C extends { verify: (...args: any[]) => Promise<any> }>(
  client: C,
  ctx: { service: AudienceService; issuer: string | undefined | null; mode: () => AudienceMode; route?: string },
  warn: (message: string, fields: Record<string, unknown>) => void,
): C {
  const verify = client.verify.bind(client);
  return {
    ...client,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verify: async (...args: any[]) =>
      applyAudienceCheck(await verify(...args), { service: ctx.service, issuer: ctx.issuer, mode: ctx.mode(), route: ctx.route }, warn),
  };
}
