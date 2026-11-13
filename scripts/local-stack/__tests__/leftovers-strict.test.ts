import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The local stack's gating leftover check stays strict (#1111, #1177): it may allow only the
 * revocation records (user id only, kept to outlive the tokens). The queue-message archive
 * (r2 al-ummah-now-messages) is never allowed: it is pseudonymised at write time, so a run's ids
 * found there mean the pseudonymisation broke, which is a privacy bug, not noise.
 */
const WORKFLOW = join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'local-e2e.yml');
const ALLOWED = ['d1:al-ummah-now-d1:user_revocations', 'kv:TOKEN_REVOCATIONS'];

function leftoverCommands(): string[] {
  const text = readFileSync(WORKFLOW, 'utf8');
  // `run: >-` folds the next indented lines into one command
  const commands: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('scripts/local-stack/leftovers.ts')) continue;
    let command = lines[i];
    for (let j = i + 1; j < lines.length && /^\s+--/.test(lines[j]); j++) command += ` ${lines[j].trim()}`;
    commands.push(command);
  }
  return commands;
}

test('the gating leftover checks allow only the revocation records', () => {
  const commands = leftoverCommands();
  assert.ok(commands.length >= 3, `found ${commands.length} leftover checks`);
  const gating = commands.filter((c) => !c.includes('--report-only'));
  assert.ok(gating.length >= 1, 'at least one leftover check gates');
  for (const command of gating) {
    const allows = [...command.matchAll(/--allow\s+(\S+)/g)].map((m) => m[1]);
    assert.deepEqual(allows.filter((a) => !ALLOWED.includes(a)), [], `unexpected --allow in: ${command.trim()}`);
  }
});

test('no leftover check allows the queue-message archive', () => {
  for (const command of leftoverCommands()) assert.ok(!/al-ummah-now-messages/.test(command), command.trim());
});
