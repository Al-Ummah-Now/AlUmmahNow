/**
 * Apple App Attest verification (https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server).
 *
 * Attestation, once per key: the credential certificate chains to Apple's App Attestation Root CA,
 * its nonce extension equals SHA-256(authData || clientDataHash), the key id is SHA-256 of its
 * public key, authData names our app (rpIdHash = SHA-256 of "<Team ID>.<bundle id>"), counter 0,
 * the environment's AAGUID, and the credential id is the key id. We keep the public key.
 *
 * Assertion, per proof: the signature over SHA-256(authData || clientDataHash) verifies with the
 * kept key, rpIdHash names the same app, and the counter went up.
 *
 * clientDataHash is SHA-256 of the UTF-8 challenge the app got from us (NAT-REL contract).
 */
import { APPLE_APP_ATTESTATION_ROOT_CA_PEM } from './apple-root';
import {
  bytesFromBase64,
  concat,
  decodeCbor,
  derChildren,
  ecdsaDerToRaw,
  equalBytes,
  importSpki,
  parseCertificate,
  pemToDer,
  readDer,
  sha256,
  signedBy,
  type Cbor,
  type Certificate,
} from './encoding';

/** 1.2.840.113635.100.8.2: the App Attest nonce extension */
const OID_APPLE_NONCE = '2a864886f763640802';
const AAGUID_PRODUCTION = new Uint8Array([...new TextEncoder().encode('appattest'), 0, 0, 0, 0, 0, 0, 0]);
const AAGUID_DEVELOPMENT = new TextEncoder().encode('appattestdevelop');

export type AppleFailure =
  | 'malformed'
  | 'bad_format'
  | 'bad_chain'
  | 'expired_certificate'
  | 'bad_nonce'
  | 'bad_key_id'
  | 'wrong_app'
  | 'bad_counter'
  | 'wrong_environment'
  | 'bad_credential_id'
  | 'bad_signature';

export interface AttestedKey {
  /** SPKI of the credential's P-256 key, base64url */
  publicKey: Uint8Array;
  appId: string;
  counter: number;
}

interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  aaguid?: Uint8Array;
  credentialId?: Uint8Array;
}

function parseAuthData(data: Uint8Array, attested: boolean): AuthData {
  if (data.length < 37) throw new Error('authData: too short');
  const counter = new DataView(data.buffer, data.byteOffset + 33, 4).getUint32(0);
  const out: AuthData = { rpIdHash: data.slice(0, 32), flags: data[32], counter };
  if (attested) {
    if (data.length < 55) throw new Error('authData: no attested credential');
    out.aaguid = data.slice(37, 53);
    const idLength = (data[53] << 8) | data[54];
    if (data.length < 55 + idLength) throw new Error('authData: truncated credential id');
    out.credentialId = data.slice(55, 55 + idLength);
  }
  return out;
}

function field(map: Cbor, key: string): Cbor | undefined {
  return map instanceof Map ? map.get(key) : undefined;
}

/** The nonce inside the extension: SEQUENCE { [1] { OCTET STRING nonce } } */
function nonceOf(cert: Certificate): Uint8Array | null {
  const ext = cert.extensions.get(OID_APPLE_NONCE);
  if (!ext) return null;
  try {
    const seq = readDer(ext);
    const tagged = derChildren(seq).find((n) => n.tag === 0xa1);
    if (!tagged) return null;
    const octets = derChildren(tagged)[0];
    return octets?.tag === 0x04 ? octets.value : null;
  } catch {
    return null;
  }
}

function within(cert: Certificate, now: Date): boolean {
  return cert.notBefore.getTime() <= now.getTime() && now.getTime() <= cert.notAfter.getTime();
}

export interface AttestationInput {
  /** As DCAppAttestService returns it: base64 of SHA-256 of the public key */
  keyId: string;
  /** base64 attestation object */
  attestation: string;
  challenge: string;
  /** "<Team ID>.<bundle id>" the app says it is (already checked against the settings) */
  appId: string;
  environment: 'production' | 'development';
  now?: Date;
  /** Tests only: another root */
  rootPem?: string;
}

export async function verifyAppleAttestation(input: AttestationInput): Promise<{ ok: true; key: AttestedKey } | { ok: false; reason: AppleFailure }> {
  const now = input.now ?? new Date();
  let object: Cbor;
  let keyId: Uint8Array;
  try {
    keyId = bytesFromBase64(input.keyId);
    object = decodeCbor(bytesFromBase64(input.attestation));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (field(object, 'fmt') !== 'apple-appattest') return { ok: false, reason: 'bad_format' };
  const statement = field(object, 'attStmt');
  const x5c = field(statement as Cbor, 'x5c');
  const authDataBytes = field(object, 'authData');
  if (!Array.isArray(x5c) || x5c.length < 2 || !(x5c[0] instanceof Uint8Array) || !(x5c[1] instanceof Uint8Array) || !(authDataBytes instanceof Uint8Array)) {
    return { ok: false, reason: 'malformed' };
  }
  let credential: Certificate;
  let intermediate: Certificate;
  let root: Certificate;
  let authData: AuthData;
  try {
    credential = parseCertificate(x5c[0]);
    intermediate = parseCertificate(x5c[1]);
    root = parseCertificate(pemToDer(input.rootPem ?? APPLE_APP_ATTESTATION_ROOT_CA_PEM));
    authData = parseAuthData(authDataBytes, true);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // 1. The chain: credential ← intermediate ← Apple's root, each in date
  if (!(await signedBy(credential, intermediate).catch(() => false)) || !(await signedBy(intermediate, root).catch(() => false))) {
    return { ok: false, reason: 'bad_chain' };
  }
  if (!within(credential, now) || !within(intermediate, now) || !within(root, now)) return { ok: false, reason: 'expired_certificate' };
  // 2-4. The nonce binds this attestation to our challenge
  const clientDataHash = await sha256(input.challenge);
  const expectedNonce = await sha256(concat(authDataBytes, clientDataHash));
  const nonce = nonceOf(credential);
  if (!nonce || !equalBytes(nonce, expectedNonce)) return { ok: false, reason: 'bad_nonce' };
  // 5. The key id is the hash of the credential's public key
  if (!equalBytes(await sha256(credential.publicKeyPoint), keyId)) return { ok: false, reason: 'bad_key_id' };
  // 6-9. authData: our app, a fresh key, the right environment, this key
  if (!equalBytes(authData.rpIdHash, await sha256(input.appId))) return { ok: false, reason: 'wrong_app' };
  if (authData.counter !== 0) return { ok: false, reason: 'bad_counter' };
  const aaguid = input.environment === 'development' ? AAGUID_DEVELOPMENT : AAGUID_PRODUCTION;
  if (!authData.aaguid || !equalBytes(authData.aaguid, aaguid)) return { ok: false, reason: 'wrong_environment' };
  if (!authData.credentialId || !equalBytes(authData.credentialId, keyId)) return { ok: false, reason: 'bad_credential_id' };
  return { ok: true, key: { publicKey: credential.spki, appId: input.appId, counter: 0 } };
}

export interface AssertionInput {
  /** base64 assertion object */
  assertion: string;
  challenge: string;
  key: AttestedKey;
}

export async function verifyAppleAssertion(input: AssertionInput): Promise<{ ok: true; counter: number } | { ok: false; reason: AppleFailure }> {
  let object: Cbor;
  try {
    object = decodeCbor(bytesFromBase64(input.assertion));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const signature = field(object, 'signature');
  const authDataBytes = field(object, 'authenticatorData');
  if (!(signature instanceof Uint8Array) || !(authDataBytes instanceof Uint8Array)) return { ok: false, reason: 'malformed' };
  let authData: AuthData;
  try {
    authData = parseAuthData(authDataBytes, false);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const nonce = await sha256(concat(authDataBytes, await sha256(input.challenge)));
  let valid = false;
  try {
    const key = await importSpki(input.key.publicKey, 'P-256');
    valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, ecdsaDerToRaw(signature, 32), nonce);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };
  if (!equalBytes(authData.rpIdHash, await sha256(input.key.appId))) return { ok: false, reason: 'wrong_app' };
  if (authData.counter <= input.key.counter) return { ok: false, reason: 'bad_counter' };
  return { ok: true, counter: authData.counter };
}
