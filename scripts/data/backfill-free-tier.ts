/**
 * Writes the Free tier to every account without a stored tier
 * (./free-tier-backfill.ts; wiki AUN-TIER-REQUESTS "Default tier"). Run after
 * the release that ships migration 0065, per environment, dry run first:
 *
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-free-tier.ts --env qa            # dry run: counts only
 *   node --experimental-strip-types --no-warnings scripts/data/backfill-free-tier.ts --env qa --apply
 *   ... --env stage | --env production
 *
 * The search D1 only, through the Cloudflare D1 API, in keyset batches on
 * indexed columns (never a full scan, never the Auth D1). Idempotent.
 * Needs CLOUDFLARE_API_TOKEN (or `wrangler login`) with D1 edit.
 */
import { createCfClient, d1Query } from '../release/cf-api.ts';
import { backfillAll, BACKFILL_TIER_ID } from './free-tier-backfill.ts';

/** al-ummah-now-search{-qa,-stage,} (apps/api-videos wrangler configs) */
const SEARCH_DBS = { qa: '0282bac3-5b70-4343-a991-937c732d981a', stage: '956a3550-bd20-4cfc-9bf2-b1c2265b33dd', production: '41064871-cf1f-46e9-b102-7b913240ad89' } as const;
type Env = keyof typeof SEARCH_DBS;

const args = process.argv.slice(2);
const env = args[args.indexOf('--env') + 1] as Env;
const apply = args.includes('--apply');
if (!args.includes('--env') || !(env in SEARCH_DBS)) {
  console.error('usage: backfill-free-tier.ts --env qa|stage|production [--apply]');
  process.exit(2);
}

const cf = createCfClient();
const query = <Row>(sql: string, params: unknown[] = []) => d1Query<Row>(cf, SEARCH_DBS[env], sql, params);

const tier = await query<{ id: string }>('SELECT id FROM creator_tiers WHERE id = ? AND deleted_at IS NULL', [BACKFILL_TIER_ID]);
if (!tier.length) {
  console.error(`${env}: the Free tier is not in the database yet (migration 0065 not applied): nothing done`);
  process.exit(1);
}
let pages = 0;
const result = await backfillAll(query, {
  dryRun: !apply,
  onPage: (source, page) => {
    pages += 1;
    if (page.missing.length) console.log(`${source}: ${page.missing.length} without a tier${apply ? `, ${page.written} written` : ''}`);
  },
});
console.log(
  `${env} ${apply ? 'APPLIED' : 'dry run'}: ${result.missing} accounts without a tier` +
    ` (profiles ${result.bySource.profile.missing}, channel owners ${result.bySource.channel.missing}, video owners ${result.bySource.video.missing})` +
    `${apply ? `, ${result.written} written` : ''}; ${pages} pages`,
);
