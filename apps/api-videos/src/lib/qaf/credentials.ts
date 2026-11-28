import { getSecret } from '../env-helpers';

const scope = new TextEncoder().encode('al-ummah:qaf-sources:key:v1');
export interface QafSecretEnv { INTERNAL_API_KEY?: unknown }

async function encryptionKey(env: QafSecretEnv) {
  const master = await getSecret(env.INTERNAL_API_KEY, 'INTERNAL_API_KEY');
  if (master.length < 16) throw new Error('Qaf encryption is unavailable');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(master), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: scope, info: scope }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export async function sealQafKey(env: QafSecretEnv, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(env), new TextEncoder().encode(value));
  return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}

export async function openQafKey(env: QafSecretEnv, stored: string) {
  const [version, iv, cipher] = stored.split('.');
  if (version !== 'v1' || !iv || !cipher) throw new Error('Qaf credential format is invalid');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await encryptionKey(env), unb64(cipher));
  return new TextDecoder().decode(plain);
}
