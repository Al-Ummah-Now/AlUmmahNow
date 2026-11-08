# AI moderation golden set (Epic 28, story 28.4)

`golden.jsonl`: synthetic items, half Arabic (MSA and Gulf, Egyptian, Levantine dialects), half
English. `label` is `safe`, a platform category (`spam`, `charity_scam`, …) or a Llama Guard code
(`S1`, `S11`, …). `kind: hard_negative` marks religious content that naive filters flag (Qur'an verses
about battle, fiqh of purity, history, du'a, nasheed lyrics). **No real users' content.** Grow it from
reviewer labels in the admin queue (labels and synthetic rewrites only).

- CI: `src/__tests__/moderation-golden.test.ts` runs every item through the pipeline with a **mocked**
  Workers AI and checks parsing and decisions.
- Live (costs neurons; run against QA's account, never in CI):

  ```bash
  EVAL_LIVE=1 CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
    pnpm --filter @al-ummah/processor exec jest src/__tests__/moderation-golden.test.ts -t live
  ```

  Prints precision and recall per category × language, with and without the extension classifier.
  Enforcement gate (plan §7): precision ≥ 0.90 for `hide`, recall ≥ 0.80 for `flag`, both languages.
