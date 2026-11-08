import type { NextRequest } from 'next/server';

/**
 * The public origin of this request (the embed host of this environment).
 * Uses the Host header only: X-Forwarded-Host is client-controllable on Workers
 * and must not decide the host written into oEmbed HTML or share metadata.
 */
export function requestOrigin(request: Pick<NextRequest, 'headers' | 'nextUrl'>): string {
  return originFromHost(request.headers.get('host') || request.nextUrl.host);
}

export function originFromHost(host: string): string {
  const local = host.startsWith('localhost') || host.startsWith('127.');
  return `${local ? 'http' : 'https'}://${host}`;
}
