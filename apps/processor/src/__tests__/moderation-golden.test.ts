/**
 * Epic 28 golden set (eval/golden.jsonl).
 *  - Mocked (CI): every item goes through the real pipeline with a mocked Workers AI that returns the
 *    labelled verdict; checks that parsing and decisions agree with the labels.
 *  - Live (EVAL_LIVE=1, QA account, costs neurons): real Workers AI over the REST API; prints
 *    precision/recall per category × language. Never runs in CI.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '@al-ummah/logger';
import { LLAMA_GUARD_CATEGORIES, type ModerationScanPayload } from '@al-ummah/shared-types';
import { handleModerationScan } from '../moderation/consumer';
import type { AiBinding } from '../moderation/ai';
import { DEFAULT_POLICIES } from '../moderation/config';
import { detectLanguage } from '../moderation/text';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

interface GoldenItem {
  id: string;
  lang: 'ar' | 'en';
  label: string;
  kind: string;
  text: string;
}

const items: GoldenItem[] = readFileSync(join(__dirname, '..', '..', 'eval', 'golden.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const logger = createLogger('processor-test', { logLevel: 'error' });

function freshEnv(ai: AiBinding, extensions: boolean) {
  const db = createSqliteD1(REPORTS_MIGRATIONS_DIR);
  const set = (k: string, v: unknown) => db.raw.prepare('INSERT INTO moderation_config (key, value, updated_at) VALUES (?, ?, ?)').run(k, JSON.stringify(v), 'now');
  set('enabled', true);
  set('daily_neuron_cap', 1e9);
  set('extensions_enabled', extensions);
  return { db, env: { REPORTS_DB: db, AI: ai, AI_MODERATION_ENABLED: 'true' } };
}

const toPayload = (item: GoldenItem): ModerationScanPayload => ({
  surface: 'video_comment',
  subjectId: item.id,
  event: 'create',
  text: item.text,
  timestamp: new Date().toISOString(),
});

async function scanAll(ai: AiBinding, extensions: boolean) {
  const { db, env } = freshEnv(ai, extensions);
  const out: { item: GoldenItem; decision: string; scores: Record<string, number> }[] = [];
  for (const item of items) {
    const result = await handleModerationScan(toPayload(item), env, logger, { lastAttempt: true });
    const row = db.raw.prepare('SELECT categories_json FROM moderation_signals WHERE subject_id = ?').get(item.id);
    out.push({ item, decision: result.decision, scores: row ? JSON.parse(String(row.categories_json)) : {} });
  }
  return out;
}

describe('golden set (mocked Workers AI)', () => {
  it('is balanced between Arabic and English and labels only known categories', () => {
    const ar = items.filter((i) => i.lang === 'ar').length;
    expect(Math.abs(ar - (items.length - ar))).toBeLessThanOrEqual(4);
    for (const item of items) {
      expect(item.label === 'safe' || item.label in DEFAULT_POLICIES).toBe(true);
      expect(detectLanguage(item.text)).toBe(item.lang);
    }
    expect(items.filter((i) => i.kind === 'hard_negative').length).toBeGreaterThanOrEqual(15);
  });

  it('labelled verdicts produce the expected shadow decisions', async () => {
    // The mock answers from the label of the item whose text (or translation marker) it receives.
    const byText = new Map(items.map((i) => [i.text, i]));
    const ai: AiBinding = {
      run: async (model, input) => {
        if (model.includes('m2m100')) return { translated_text: `EN:${String(input.text)}` };
        const messages = input.messages as { role: string; content: string }[];
        const content = messages[messages.length - 1].content;
        const item = byText.get(content.replace(/^EN:/, ''))!;
        if (model.includes('llama-guard')) {
          return item.label in LLAMA_GUARD_CATEGORIES ? { response: `unsafe\n${item.label}` } : { response: { safe: true, categories: [] } };
        }
        const scores = item.label in LLAMA_GUARD_CATEGORIES || item.label === 'safe' ? {} : { [item.label]: 0.95 };
        return { response: JSON.stringify({ scores }) };
      },
    };
    const results = await scanAll(ai, true);
    for (const { item, decision } of results) {
      if (item.label === 'safe') expect([item.id, decision]).toEqual([item.id, 'none']);
      else if (item.label === 'religious_authenticity') expect([item.id, decision]).toEqual([item.id, 'none']); // opt-in, off by default
      else if (item.label === 'spam') expect([item.id, decision]).toEqual([item.id, 'would_hide']);
      // charity_scam hides only for low-trust authors; no trust score yet (28.2), so it flags
      else if (item.label === 'charity_scam') expect([item.id, decision]).toEqual([item.id, 'would_flag']);
      else expect([item.id, decision]).toEqual([item.id, 'would_flag']);
    }
  });
});

const live = process.env.EVAL_LIVE === '1' ? describe : describe.skip;

live('golden set (live Workers AI)', () => {
  jest.setTimeout(15 * 60 * 1000);
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const restAi: AiBinding = {
    run: async (model, input) => {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = (await res.json()) as { success: boolean; result: unknown; errors?: unknown };
      if (!body.success) throw new Error(`Workers AI ${model}: ${JSON.stringify(body.errors)}`);
      return body.result;
    },
  };

  for (const extensions of [false, true]) {
    it(`reports precision/recall (extensions ${extensions ? 'on' : 'off'})`, async () => {
      const results = await scanAll(restAi, extensions);
      const lines: string[] = [`\n=== live eval, extensions ${extensions ? 'on' : 'off'} ===`];
      for (const lang of ['en', 'ar'] as const) {
        const rows = results.filter((r) => r.item.lang === lang);
        const flagged = (r: (typeof rows)[number]) => r.decision !== 'none' && !r.decision.startsWith('skipped');
        const tp = rows.filter((r) => r.item.label !== 'safe' && flagged(r)).length;
        const fp = rows.filter((r) => r.item.label === 'safe' && flagged(r));
        const fn = rows.filter((r) => r.item.label !== 'safe' && !flagged(r));
        const precision = tp + fp.length ? tp / (tp + fp.length) : 1;
        const recall = tp + fn.length ? tp / (tp + fn.length) : 1;
        lines.push(`[${lang}] any-flag precision ${precision.toFixed(2)} recall ${recall.toFixed(2)} (tp ${tp}, fp ${fp.length}, fn ${fn.length})`);
        for (const r of fp) lines.push(`  FP ${r.item.id} (${r.item.kind}) ${JSON.stringify(r.scores)}`);
        for (const r of fn) lines.push(`  FN ${r.item.id} label=${r.item.label} ${JSON.stringify(r.scores)}`);
        const labels = [...new Set(rows.map((r) => r.item.label))].filter((l) => l !== 'safe');
        for (const label of labels) {
          const policy = DEFAULT_POLICIES[label as keyof typeof DEFAULT_POLICIES];
          const hit = (r: (typeof rows)[number]) => (r.scores[label] ?? 0) >= (policy?.threshold ?? 0.5);
          const pos = rows.filter((r) => r.item.label === label);
          const predicted = rows.filter(hit);
          const correct = pos.filter(hit).length;
          lines.push(`  ${label.padEnd(24)} recall ${(correct / pos.length).toFixed(2)} precision ${predicted.length ? (correct / predicted.length).toFixed(2) : '—'}`);
        }
      }
      process.stdout.write(lines.join('\n') + '\n');
      expect(results.every((r) => !r.decision.startsWith('skipped'))).toBe(true);
    });
  }
});
