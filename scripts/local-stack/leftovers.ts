/**
 * End-of-job check: nothing a run created is left in the local stack (owner rule: test sets clean
 * up every resource they use, even when a test fails).
 *
 *   node --experimental-strip-types --no-warnings scripts/local-stack/leftovers.ts --marker "$E2E_RUN_ID" [--report-only] [--allow d1:<db>:<table>|r2:<bucket>|kv:<binding>|fake-bunny ...]
 *
 * Asks the running stack (GET /__stack/leftovers) for every D1 row, R2 object, KV entry, fake
 * Bunny video and fake image that still holds the marker (the run id: run accounts are
 * e2e+<run id>-…, builders' names start with it) or the id of a run user. Prints them and exits 1,
 * unless --report-only (a batch whose specs do not clean up fully yet) or every hit is allowed.
 * Writes the result to $GITHUB_STEP_SUMMARY when set.
 */
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const values = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]] : []));
const marker = values('--marker')[0] ?? process.env.E2E_RUN_ID ?? '';
const reportOnly = args.includes('--report-only');
const allow = values('--allow');
const control = process.env.LOCAL_STACK_CONTROL_URL || 'http://127.0.0.1:3190';

if (marker.length < 6) {
  process.stderr.write('leftovers: --marker <run id> (or E2E_RUN_ID) is required\n');
  process.exit(2);
}

interface Hit { store: string; location: string; sample: string }
const res = await fetch(`${control}/__stack/leftovers?marker=${encodeURIComponent(marker)}`);
if (!res.ok) {
  process.stderr.write(`leftovers: the stack answered ${res.status}: ${await res.text()}\n`);
  process.exit(2);
}
const result = (await res.json()) as { runUserIds: string[]; hits: Hit[]; truncated: boolean };
const allowed = (hit: Hit) => allow.some((a) => `${hit.store}:${hit.location}`.startsWith(a) || hit.store === a);
const left = result.hits.filter((h) => !allowed(h));

const byStore = new Map<string, number>();
for (const hit of left) byStore.set(`${hit.store} ${hit.location.split('/')[0]}`, (byStore.get(`${hit.store} ${hit.location.split('/')[0]}`) ?? 0) + 1);
const lines = [
  `Leftovers of run ${marker}: ${left.length}${result.truncated ? '+' : ''} (run users: ${result.runUserIds.length}${allow.length ? `, allowed: ${allow.join(', ')}` : ''})`,
  ...[...byStore].sort((a, b) => b[1] - a[1]).map(([where, n]) => `  ${n}\t${where}`),
  ...left.slice(0, 40).map((h) => `  - ${h.store} ${h.location}: ${h.sample.replace(/\s+/g, ' ').slice(0, 140)}`),
];
process.stdout.write(`${lines.join('\n')}\n`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Leftovers\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
}
if (left.length && !reportOnly) process.exit(1);
