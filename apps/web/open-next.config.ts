import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * No shared incremental cache (SCALABILITY-AUDIT WEB-3).
 *
 * kvIncrementalCache was selected without a NEXT_INC_CACHE_KV binding, so
 * fetch caching (`next.revalidate`) and revalidatePath silently did nothing,
 * or kept per-isolate copies that differed between isolates. With the
 * default (no incremental cache) every isolate behaves the same: data
 * fetches go to the API, which caches at its own layer.
 *
 * Adding ISR or relying on `next.revalidate` needs a shared cache first: a
 * KV namespace bound as NEXT_INC_CACHE_KV (or an R2 bucket for the R2 cache)
 * plus a tag cache (D1 or Durable Object) for revalidatePath/revalidateTag,
 * provisioned by the owner and bound in every wrangler config.
 */
/**
 * Skew protection (docs/release-pipeline/SKEW-PROTECTION.md): a page built by an
 * older deploy sends its build's deployment id (NEXT_DEPLOYMENT_ID, set per CI
 * build) with every RSC request, Server Action and chunk URL; the Worker serves
 * it from the Worker version that built it, through that version's preview URL,
 * for as long as the version is in CF_DEPLOYMENT_MAPPING (written at upload by
 * scripts/release/skew-mapping.ts with the same retention as below). Older pages
 * fall back to the current build, and the client recovers by reloading
 * (src/lib/version-skew).
 */
export const SKEW_RETENTION = { maxNumberOfVersions: 20, maxVersionAgeDays: 7 };

const config = defineCloudflareConfig({});
config.cloudflare = { ...config.cloudflare, skewProtection: { enabled: true, ...SKEW_RETENTION } };

export default config;
