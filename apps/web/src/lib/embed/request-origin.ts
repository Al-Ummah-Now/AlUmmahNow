import type { NextRequest } from 'next/server';
import { isLocalHostHeader, safeHostHeader } from '@/lib/security/safe-input';

/**
 * The public origin of this request (the embed host of this environment).
 * Uses the Host header only: X-Forwarded-Host is client-controllable on Workers
 * and must not decide the host written into oEmbed HTML or share metadata.
 */
export function requestOrigin(request: Pick<NextRequest, 'headers' | 'nextUrl'>): string {
  const host = safeHostHeader(request.headers.get('host')) || safeHostHeader(request.nextUrl.host) || 'localhost';
  return originFromHost(host);
}

export function originFromHost(host: string): string {
  const safe = safeHostHeader(host) ?? 'localhost';
  const local = isLocalHostHeader(safe);
  return `${local ? 'http' : 'https'}://${safe}`;
}
