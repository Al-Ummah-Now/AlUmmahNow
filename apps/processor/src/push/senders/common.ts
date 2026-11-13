/**
 * Shared bits of the push senders: secret reads, base64url, PEM keys, a fetch seam for tests.
 *
 * Secrets come from Secrets Store bindings (see wrangler configs). A missing, empty or
 * placeholder value means "not configured": the provider stays log-only, as before #414.
 */

export type SecretBinding = string | { get: () => Promise<string> } | undefined;

/** Values the owner has not supplied yet (Secrets Store entries are created with a placeholder). */
export function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || v.startsWith('placeholder') || v === 'unset';
}

export async function readSecret(binding: SecretBinding): Promise<string | null> {
  if (!binding) return null;
  try {
    const value = typeof binding === 'string' ? binding : await binding.get();
    return value && !isPlaceholder(value) ? value : null;
  } catch {
    // Secrets Store answers an error for a secret that does not exist in this env
    return null;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function base64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of data) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCS#8 PEM (the "BEGIN PRIVATE KEY" armour) → DER bytes. Escaped "\n" (JSON) is accepted. */
export function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** A compact JWS: header.payload.signature, signed with `sign` over the first two parts. */
export async function signJwt(header: Record<string, unknown>, claims: Record<string, unknown>, sign: (data: ArrayBuffer) => Promise<ArrayBuffer>): Promise<string> {
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const bytes = new TextEncoder().encode(input);
  const signature = await sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return `${input}.${base64url(signature)}`;
}

export const nowSeconds = (now: number) => Math.floor(now / 1000);

export async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
