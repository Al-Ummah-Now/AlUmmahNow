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
export default defineCloudflareConfig({});
