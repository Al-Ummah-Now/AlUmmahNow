/**
 * An account event as Auth sends it: a Security Event Token (RFC 8417) for our machine client, signed with the key
 * that signs access tokens (AlUmmahNowAuth docs/account-hub/SPEC.md §5.4). It is checked against Auth's JWKS, and
 * nothing else is believed: the issuer, the audience (env.ClientId, API Videos), `typ` secevent+jwt, a jti, a seq and
 * exactly one event we know.
 */
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export const EVENT_TYPES = {
	'https://schemas.openid.net/secevent/risc/event-type/account-disabled': 'account-disabled',
	'https://schemas.openid.net/secevent/risc/event-type/account-enabled': 'account-enabled',
	'https://schemas.openid.net/secevent/risc/event-type/account-purged': 'account-purged',
	'https://schemas.openid.net/secevent/ssf/event-type/verification': 'verification',
} as const;
export type AccountEventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface AccountEvent {
	jti: string;
	seq: number;
	type: AccountEventType;
	/** '' for a verification, which is about no account. */
	userId: string;
	reason: 'age' | 'deleted' | null;
}

export interface SetEnv {
	Issuer?: string;
	ClientId?: string;
}

/** RFC 8935 §2.4 error codes: the sender's fault, so sending it again changes nothing. */
export type SetErrorCode = 'invalid_request' | 'invalid_key' | 'invalid_issuer' | 'invalid_audience';
export class SetError extends Error {
	constructor(
		readonly code: SetErrorCode,
		description: string,
	) {
		super(description);
	}
}

/** Auth signs an event again for every try, so an old one is a replay. */
const MAX_AGE = '1h';
const CLOCK_TOLERANCE_S = 60;
const JTI = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const USER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Auth publishes a new key an hour before it signs, so ten minutes old is fresh enough. */
const KEYS_TTL_MS = 10 * 60_000;
/** A key that is not among them is looked up again at most this often. */
const KEYS_AGAIN_MS = 30_000;
const KEYS_TIMEOUT_MS = 5_000;

type Keys = ReturnType<typeof createLocalJWKSet>;
let cached: { issuer: string; keys: Keys; at: number } | null = null;

async function fetchKeys(issuer: string): Promise<Keys> {
	const res = await fetch(new URL('/.well-known/jwks.json', issuer).href, { signal: AbortSignal.timeout(KEYS_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`The keys could not be read (${res.status})`);
	const keys = createLocalJWKSet((await res.json()) as JSONWebKeySet);
	cached = { issuer, keys, at: Date.now() };
	return keys;
}

/** Auth's key for a token, from this isolate's copy of its JWKS. */
function keyOf(issuer: string): JWTVerifyGetKey {
	return async (header, token) => {
		const mine = cached?.issuer === issuer && Date.now() - cached.at < KEYS_TTL_MS ? cached : null;
		try {
			return await (mine?.keys ?? (await fetchKeys(issuer)))(header, token);
		} catch (error) {
			if (!(error instanceof errors.JWKSNoMatchingKey) || !mine || Date.now() - mine.at < KEYS_AGAIN_MS) throw error;
			return (await fetchKeys(issuer))(header, token);
		}
	};
}

/** Tests only. */
export function forgetKeys(): void {
	cached = null;
}

function refusalOf(error: unknown): SetError | null {
	if (error instanceof errors.JWTClaimValidationFailed) {
		if (error.claim === 'iss') return new SetError('invalid_issuer', 'The issuer is not ours');
		if (error.claim === 'aud') return new SetError('invalid_audience', 'The token is for someone else');
		return new SetError('invalid_request', `The claim ${error.claim} is not valid`);
	}
	if (error instanceof errors.JWSSignatureVerificationFailed) return new SetError('invalid_key', 'The signature is not valid');
	if (error instanceof errors.JWTExpired || error instanceof errors.JWTInvalid || error instanceof errors.JWSInvalid || error instanceof errors.JOSEAlgNotAllowed || error instanceof errors.JOSENotSupported) {
		return new SetError('invalid_request', 'Not a valid token');
	}
	// The keys could not be read, or the key is new here: not the sender's fault, it tries again
	return null;
}

/** The event in a token. Throws SetError when it is refused for good, anything else when it could not be checked. */
export async function readSet(token: string, env: SetEnv): Promise<AccountEvent> {
	const { Issuer: issuer, ClientId: audience } = env;
	if (!issuer || !audience) throw new Error('Issuer or ClientId is not set');
	let payload: JWTPayload;
	try {
		({ payload } = await jwtVerify(token, keyOf(issuer), {
			issuer,
			audience,
			typ: 'secevent+jwt',
			algorithms: ['ES256'],
			requiredClaims: ['jti', 'iat'],
			maxTokenAge: MAX_AGE,
			clockTolerance: CLOCK_TOLERANCE_S,
		}));
	} catch (error) {
		throw refusalOf(error) ?? error;
	}
	return eventOf(payload, issuer, audience);
}

function eventOf(p: JWTPayload, issuer: string, audience: string): AccountEvent {
	const refuse = (what: string): never => {
		throw new SetError('invalid_request', what);
	};
	// One audience: ours
	if (p.aud !== audience) throw new SetError('invalid_audience', 'The token is for someone else');
	if (typeof p.jti !== 'string' || !JTI.test(p.jti)) return refuse('The jti is not valid');
	if (typeof p.seq !== 'number' || !Number.isSafeInteger(p.seq) || p.seq < 1) return refuse('The seq is not valid');
	const events = p.events && typeof p.events === 'object' && !Array.isArray(p.events) ? Object.entries(p.events as Record<string, unknown>) : [];
	if (events.length !== 1) return refuse('One event is expected');
	const [uri, detail] = events[0]!;
	if (!Object.hasOwn(EVENT_TYPES, uri)) return refuse('The event is not known here');
	const type = EVENT_TYPES[uri as keyof typeof EVENT_TYPES];
	const about = (p.sub_id ?? {}) as { format?: unknown; iss?: unknown; sub?: unknown; id?: unknown };
	if (type === 'verification') {
		if (about.format !== 'opaque' || about.id !== audience) return refuse('The subject is not valid');
		return { jti: p.jti, seq: p.seq, type, userId: '', reason: null };
	}
	if (about.format !== 'iss_sub' || about.iss !== issuer || typeof about.sub !== 'string' || !USER_ID.test(about.sub)) return refuse('The subject is not valid');
	let reason: AccountEvent['reason'] = null;
	if (type === 'account-disabled') {
		const given = (detail as { reason?: unknown } | null)?.reason;
		if (given !== 'age' && given !== 'deleted') return refuse('The reason is not valid');
		reason = given;
	}
	return { jti: p.jti, seq: p.seq, type, userId: about.sub, reason };
}
