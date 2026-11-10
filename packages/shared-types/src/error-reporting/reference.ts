/**
 * References the user can quote to support: ERR-XXXX-XXXX in Crockford
 * base32 (no I, L, O, U), so they read well over the phone and in Arabic UI.
 */
import { hash64 } from './fingerprint';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function format(bits: number[]): string {
  const chars = bits.map((b) => ALPHABET[b & 31]).join('');
  return `ERR-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

/** A new random reference. */
export function newErrorRef(): string {
  const bytes = new Uint8Array(8);
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return format(Array.from(bytes));
}

/**
 * The reference of a server-rendering error, derived from Next's digest:
 * the server (instrumentation onRequestError) and the browser (error
 * boundary, which only receives the digest) compute the same reference.
 */
export function errorRefFromDigest(digest: string): string {
  const h = hash64(`digest:${digest}`);
  const bits: number[] = [];
  for (let i = 0; i < 8; i++) bits.push(parseInt(h.slice(i * 2, i * 2 + 2), 16));
  return format(bits);
}

export const ERROR_REF_PATTERN = /^ERR-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Normalises what a user typed ("err 3k9f 2b7q", lowercase, O for 0) into a reference, or null. */
export function parseErrorRef(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^ERR/, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== 8) return null;
  const ref = `ERR-${s.slice(0, 4)}-${s.slice(4)}`;
  return ERROR_REF_PATTERN.test(ref) ? ref : null;
}
