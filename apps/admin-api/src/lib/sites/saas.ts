/**
 * Cloudflare for SaaS custom hostnames on the alummahnow.org zone (wiki AUN-SCHOLAR-SITES §4.2,
 * #1212). Token: Secrets Store `sites-saas-token` (Zone → SSL and Certificates: Edit on
 * alummahnow.org), bound as SITES_SAAS_TOKEN. Certificates are DV with TXT validation, so the
 * owner can add every record at once; the CNAME to sites.alummahnow.org carries the traffic.
 */
import { SITE_SAAS_TARGET, type SiteDnsRecord, type SiteDomainStatus } from '@al-ummah/shared-types';

export const SITES_ZONE_ID = 'c3cbc1b54070d957cdcef91444b746a9';
const API = 'https://api.cloudflare.com/client/v4';

/** Cloudflare's "no quota" / not-entitled answers: Cloudflare for SaaS is not enabled on the zone. */
const SAAS_OFF_CODES = new Set([1404, 1407, 1409]);

export class SaasError extends Error {
  constructor(readonly code: 'saas_unavailable' | 'not_configured' | 'cloudflare_refused' | 'cloudflare_unreachable', readonly detail = '') {
    super(code);
  }
}

export interface CfCustomHostname {
  id: string;
  hostname: string;
  status?: string;
  ssl?: {
    status?: string;
    validation_records?: { txt_name?: string; txt_value?: string }[];
    validation_errors?: { message?: string }[];
  };
  ownership_verification?: { type?: string; name?: string; value?: string };
  verification_errors?: string[];
}

export interface SaasEnv {
  SITES_SAAS_TOKEN?: string | { get(): Promise<string> };
}

async function tokenOf(env: SaasEnv): Promise<string> {
  const b = env.SITES_SAAS_TOKEN;
  let token = '';
  try {
    token = typeof b === 'string' ? b : ((await b?.get()) ?? '');
  } catch {
    token = '';
  }
  if (!token) throw new SaasError('not_configured');
  return token;
}

export type Fetch = typeof fetch;

async function call<T>(env: SaasEnv, method: string, path: string, body: unknown, fetchImpl: Fetch): Promise<T> {
  const token = await tokenOf(env);
  let res: Response;
  try {
    res = await fetchImpl(`${API}/zones/${SITES_ZONE_ID}/custom_hostnames${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new SaasError('cloudflare_unreachable', String(error));
  }
  const parsed = (await res.json().catch(() => null)) as { success?: boolean; errors?: { code: number; message: string }[]; result?: T } | null;
  if (res.ok && parsed?.success) return parsed.result as T;
  const errors = parsed?.errors ?? [];
  if (errors.some((e) => SAAS_OFF_CODES.has(e.code) || /quota|not entitled|not enabled/i.test(e.message))) throw new SaasError('saas_unavailable', errors.map((e) => `${e.code} ${e.message}`).join('; '));
  throw new SaasError('cloudflare_refused', errors.map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`);
}

export function createHostname(env: SaasEnv, hostname: string, fetchImpl: Fetch = fetch): Promise<CfCustomHostname> {
  return call(env, 'POST', '', { hostname, ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } } }, fetchImpl);
}

export function getHostname(env: SaasEnv, id: string, fetchImpl: Fetch = fetch): Promise<CfCustomHostname> {
  return call(env, 'GET', `/${encodeURIComponent(id)}`, undefined, fetchImpl);
}

export async function deleteHostname(env: SaasEnv, id: string, fetchImpl: Fetch = fetch): Promise<void> {
  try {
    await call(env, 'DELETE', `/${encodeURIComponent(id)}`, undefined, fetchImpl);
  } catch (error) {
    // Already gone at Cloudflare is fine
    if (error instanceof SaasError && error.code === 'cloudflare_refused' && /1436|not found/i.test(error.detail)) return;
    throw error;
  }
}

const FAILED_SSL = new Set(['validation_timed_out', 'issuance_timed_out', 'deployment_timed_out', 'expired', 'deleted', 'backup_issued']);
const ISSUING_SSL = new Set(['pending_issuance', 'pending_deployment', 'deployment_timed_out_retrying']);

/** Our status for Cloudflare's hostname and certificate states. */
export function statusOf(h: CfCustomHostname): SiteDomainStatus {
  const status = h.status ?? '';
  const ssl = h.ssl?.status ?? '';
  if (status === 'blocked' || status === 'moved' || status === 'deleted' || FAILED_SSL.has(ssl)) return 'failed';
  if (status === 'active' && ssl === 'active') return 'live';
  if (ISSUING_SSL.has(ssl) || status === 'active') return 'issuing';
  return 'waiting_dns';
}

/** The records the owner adds: the traffic CNAME, the ownership TXT and the certificate TXT(s). */
export function recordsOf(h: CfCustomHostname): SiteDnsRecord[] {
  const out: SiteDnsRecord[] = [{ type: 'CNAME', name: h.hostname, value: SITE_SAAS_TARGET, purpose: 'traffic' }];
  const own = h.ownership_verification;
  if (own?.type === 'txt' && own.name && own.value) out.push({ type: 'TXT', name: own.name, value: own.value, purpose: 'ownership' });
  for (const r of h.ssl?.validation_records ?? []) {
    if (r.txt_name && r.txt_value && !out.some((x) => x.name === r.txt_name && x.value === r.txt_value)) out.push({ type: 'TXT', name: r.txt_name, value: r.txt_value, purpose: 'certificate' });
  }
  return out;
}

/** Cloudflare's reason, for the owner (first one, short). */
export function errorOf(h: CfCustomHostname): string | null {
  const reason = h.verification_errors?.[0] ?? h.ssl?.validation_errors?.[0]?.message ?? null;
  return reason ? String(reason).slice(0, 300) : null;
}
