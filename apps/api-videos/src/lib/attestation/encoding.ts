/**
 * Byte helpers for attestation: base64 / base64url, hex, SHA-256, and the two binary formats Apple
 * uses (CBOR for the attestation and assertion objects, DER for the X.509 certificates). Only the
 * parts those formats need: no indefinite lengths, no tags beyond what App Attest sends.
 */

export function bytesFromBase64(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function pemToDer(pem: string): Uint8Array {
  return bytesFromBase64(pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, ''));
}

// ---------------------------------------------------------------------------
// CBOR (RFC 8949), definite lengths only
// ---------------------------------------------------------------------------

export type Cbor = number | string | boolean | null | Uint8Array | Cbor[] | Map<Cbor, Cbor>;

export function decodeCbor(data: Uint8Array): Cbor {
  let at = 0;
  const byte = () => {
    if (at >= data.length) throw new Error('cbor: truncated');
    return data[at++];
  };
  const length = (info: number): number => {
    if (info < 24) return info;
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (!size) throw new Error('cbor: unsupported length');
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + byte();
    if (!Number.isSafeInteger(n)) throw new Error('cbor: length too large');
    return n;
  };
  const take = (n: number) => {
    if (at + n > data.length) throw new Error('cbor: truncated');
    const out = data.slice(at, at + n);
    at += n;
    return out;
  };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new Error('cbor: too deep');
    const head = byte();
    const major = head >> 5;
    const info = head & 31;
    switch (major) {
      case 0:
        return length(info);
      case 1:
        return -1 - length(info);
      case 2:
        return take(length(info));
      case 3:
        return new TextDecoder().decode(take(length(info)));
      case 4: {
        const n = length(info);
        const list: Cbor[] = [];
        for (let i = 0; i < n; i++) list.push(item(depth + 1));
        return list;
      }
      case 5: {
        const n = length(info);
        const map = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) map.set(item(depth + 1), item(depth + 1));
        return map;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error('cbor: unsupported simple value');
      default:
        throw new Error('cbor: unsupported type');
    }
  };
  const value = item(0);
  if (at !== data.length) throw new Error('cbor: trailing bytes');
  return value;
}

// ---------------------------------------------------------------------------
// DER (X.690) and the X.509 fields App Attest needs
// ---------------------------------------------------------------------------

export interface DerNode {
  tag: number;
  /** The whole TLV */
  raw: Uint8Array;
  /** The contents */
  value: Uint8Array;
}

export function readDer(data: Uint8Array, offset = 0): DerNode & { end: number } {
  if (offset + 2 > data.length) throw new Error('der: truncated');
  const tag = data[offset];
  let len = data[offset + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error('der: unsupported length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + data[offset + 2 + i];
    header += n;
  }
  const end = offset + header + len;
  if (end > data.length) throw new Error('der: truncated');
  return { tag, raw: data.slice(offset, end), value: data.slice(offset + header, end), end };
}

export function derChildren(node: DerNode): DerNode[] {
  const out: DerNode[] = [];
  let at = 0;
  while (at < node.value.length) {
    const child = readDer(node.value, at);
    out.push(child);
    at = child.end;
  }
  return out;
}

const OID_ECDSA_SHA256 = '2a8648ce3d040302';
const OID_ECDSA_SHA384 = '2a8648ce3d040303';
const OID_P256 = '2a8648ce3d030107';
const OID_P384 = '2b81040022';

export interface Certificate {
  tbs: Uint8Array;
  signatureHash: 'SHA-256' | 'SHA-384';
  /** DER ECDSA signature */
  signature: Uint8Array;
  spki: Uint8Array;
  curve: 'P-256' | 'P-384';
  /** Uncompressed EC point (0x04 || x || y) */
  publicKeyPoint: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  /** Extension values by OID hex */
  extensions: Map<string, Uint8Array>;
}

function derTime(node: DerNode): Date {
  const s = new TextDecoder().decode(node.value);
  const m = node.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new Error('der: bad time');
  let year = Number(m[1]);
  if (node.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
}

export function parseCertificate(der: Uint8Array): Certificate {
  const [tbsNode, algNode, sigNode] = derChildren(readDer(der));
  if (!tbsNode || !algNode || !sigNode || sigNode.tag !== 0x03) throw new Error('x509: not a certificate');
  const algOid = hex(derChildren(algNode)[0].value);
  const signatureHash = algOid === OID_ECDSA_SHA256 ? 'SHA-256' : algOid === OID_ECDSA_SHA384 ? 'SHA-384' : null;
  if (!signatureHash) throw new Error('x509: unsupported signature algorithm');
  const fields = derChildren(tbsNode);
  let i = fields[0]?.tag === 0xa0 ? 1 : 0; // version
  i += 1; // serial
  i += 1; // signature algorithm
  i += 1; // issuer
  const validity = derChildren(fields[i++]);
  i += 1; // subject
  const spkiNode = fields[i++];
  const [spkiAlg, spkiKey] = derChildren(spkiNode);
  const curveOid = hex(derChildren(spkiAlg)[1]?.value ?? new Uint8Array());
  const curve = curveOid === OID_P256 ? 'P-256' : curveOid === OID_P384 ? 'P-384' : null;
  if (!curve) throw new Error('x509: unsupported key');
  const extensions = new Map<string, Uint8Array>();
  for (const field of fields.slice(i)) {
    if (field.tag !== 0xa3) continue;
    for (const ext of derChildren(derChildren(field)[0])) {
      const parts = derChildren(ext);
      extensions.set(hex(parts[0].value), parts[parts.length - 1].value);
    }
  }
  return {
    tbs: tbsNode.raw,
    signatureHash,
    signature: sigNode.value.slice(1),
    spki: spkiNode.raw,
    curve,
    publicKeyPoint: spkiKey.value.slice(1),
    notBefore: derTime(validity[0]),
    notAfter: derTime(validity[1]),
    extensions,
  };
}

/** DER ECDSA-Sig-Value → raw r || s, the form WebCrypto verifies. */
export function ecdsaDerToRaw(der: Uint8Array, size: number): Uint8Array {
  const [r, s] = derChildren(readDer(der));
  const fix = (n: Uint8Array) => {
    let v = n;
    while (v.length > size && v[0] === 0) v = v.slice(1);
    if (v.length > size) throw new Error('ecdsa: bad integer');
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  };
  return concat(fix(r.value), fix(s.value));
}

export async function importSpki(spki: Uint8Array, curve: 'P-256' | 'P-384'): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: curve }, false, ['verify']);
}

/** Whether `cert` was signed by the key of `issuer`. */
export async function signedBy(cert: Certificate, issuer: Certificate): Promise<boolean> {
  const key = await importSpki(issuer.spki, issuer.curve);
  const size = issuer.curve === 'P-256' ? 32 : 48;
  return crypto.subtle.verify({ name: 'ECDSA', hash: cert.signatureHash }, key, ecdsaDerToRaw(cert.signature, size), cert.tbs);
}
