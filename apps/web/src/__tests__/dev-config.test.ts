/**
 * The dev config (wrangler.jsonc, what `next dev` loads) must never name a production host. Routes
 * that forward with the internal key read these vars, so a production URL here sent local requests
 * to production (2026-11-18). QA, stage, localhost and the local stack's hosts are fine.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCTION_HOST = /^(?:[a-z0-9-]+\.)*alummahnow\.(?:net|org|com|app|link)$/;
const NON_PRODUCTION_LABELS = new Set(['qa', 'stage', 'staging', 'preview', 'local']);

/** Every hostname in the text (http, https, ws and wss URLs and bare alummahnow hosts). */
function hostsIn(text: string): string[] {
  const hosts = new Set<string>();
  for (const m of text.matchAll(/\b(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
  for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+alummahnow\.(?:net|org|com|app|link))\b/gi)) hosts.add(m[1].toLowerCase());
  return [...hosts];
}

export function productionHosts(text: string): string[] {
  return hostsIn(text).filter((host) => PRODUCTION_HOST.test(host) && !host.split('.').some((label) => NON_PRODUCTION_LABELS.has(label)));
}

describe('apps/web/wrangler.jsonc (local dev config)', () => {
  it('names no production host', () => {
    const config = readFileSync(join(__dirname, '..', '..', 'wrangler.jsonc'), 'utf8');
    expect(productionHosts(config)).toEqual([]);
  });

  it('the check itself catches production hosts and lets QA, stage and localhost through', () => {
    expect(productionHosts('"ADMIN_API_URL": "https://admin.api.alummahnow.net"')).toEqual(['admin.api.alummahnow.net']);
    expect(productionHosts('"Issuer": "https://auth.alummahnow.net", "x": "wss://realtime.alummahnow.net/ws"')).toEqual(['auth.alummahnow.net', 'realtime.alummahnow.net']);
    expect(productionHosts('"API_URL": "https://videos.api.qa.alummahnow.net", "S": "https://videos.api.stage.alummahnow.net", "L": "http://localhost:3090"')).toEqual([]);
  });
});
